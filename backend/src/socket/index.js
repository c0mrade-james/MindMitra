const jwt = require('jsonwebtoken');
const https = require('https');
const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');

let io;
const userSocketMap = new Map(); // userId -> socketId
const sessionParticipants = new Map(); // sessionId -> Set of userIds
const joinedSockets = new Map(); // socketId -> Set of sessionId (prevents duplicate joins)

// Cache TURN credentials — refresh every 4 minutes (credentials expire in 5 min for Metered)
let cachedIceServers = null;
let iceServersCachedAt = 0;
const ICE_CACHE_TTL = 4 * 60 * 1000;

const STUN_DEFAULTS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function fetchJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function getIceServers() {
  const now = Date.now();
  if (cachedIceServers && now - iceServersCachedAt < ICE_CACHE_TTL) {
    return cachedIceServers;
  }

  // Try Metered.ca TURN credentials first
  if (env.metered?.domain && env.metered?.apiKey) {
    try {
      const url = `https://${env.metered.domain}/api/v1/turn/credentials?key=${env.metered.apiKey}`;
      const creds = await fetchJson(url);
      if (Array.isArray(creds) && creds.length > 0) {
        cachedIceServers = creds;
        iceServersCachedAt = now;
        logger.info('Fetched Metered TURN credentials successfully');
        return creds;
      }
    } catch (err) {
      logger.warn('Failed to fetch Metered TURN credentials:', err.message);
    }
  }

  // Fallback to env-configured ICE servers
  try {
    if (env.iceServers) {
      const parsed = JSON.parse(env.iceServers);
      cachedIceServers = parsed;
      iceServersCachedAt = now;
      return parsed;
    }
  } catch (err) {
    logger.warn('Failed to parse ICE_SERVERS env var');
  }

  cachedIceServers = STUN_DEFAULTS;
  iceServersCachedAt = now;
  return STUN_DEFAULTS;
}

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: env.clientUrl, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, env.accessTokenSecret);
      socket.userId = decoded.id;
      next();
    } catch (err) {
      next(new Error('Invalid socket token'));
    }
  });

  io.on('connection', (socket) => {
    userSocketMap.set(socket.userId, socket.id);
    logger.info(`Socket connected: user ${socket.userId}`);

    // Join a session room when client requests — validate session ownership
    socket.on('session:join', async ({ sessionId }) => {
      try {
        const Appointment = require('../models/Appointment.model');
        const appt = await Appointment.findOne({ sessionId });
        if (!appt) return socket.emit('session:error', { message: 'Session not found' });
        const uid = String(socket.userId);
        const studentId = String(appt.student);
        const counselorId = String(appt.counselor);
        if (uid !== studentId && uid !== counselorId) return socket.emit('session:error', { message: 'Not a participant' });

        // Prevent duplicate session:join from the same socket
        if (!joinedSockets.has(socket.id)) joinedSockets.set(socket.id, new Set());
        if (joinedSockets.get(socket.id).has(sessionId)) {
          // Already joined this session, just re-send joined + ready
          socket.emit('session:joined', { sessionId, iceServers: await getIceServers() });
          const participants = sessionParticipants.get(sessionId);
          if (participants && participants.has(studentId) && participants.has(counselorId)) {
            socket.emit('session:ready', { sessionId });
          }
          return;
        }

        socket.join(`session:${sessionId}`);
        joinedSockets.get(socket.id).add(sessionId);

        // Track which sessions this socket has joined (for cleanup on disconnect)
        if (!socket.joinedSessionIds) socket.joinedSessionIds = new Set();
        socket.joinedSessionIds.add(sessionId);

        // Track participants per session
        if (!sessionParticipants.has(sessionId)) sessionParticipants.set(sessionId, new Set());
        sessionParticipants.get(sessionId).add(uid);

        logger.info(`Session joined: user ${uid} joined room session:${sessionId}`);
        socket.emit('session:joined', { sessionId, iceServers: await getIceServers() });

        // Always emit session:ready when both participants are present (allows re-emission on reconnect)
        const participants = sessionParticipants.get(sessionId);
        if (participants.has(studentId) && participants.has(counselorId)) {
          logger.info(`Session ready: session:${sessionId}`);
          io.in(`session:${sessionId}`).emit('session:ready', { sessionId });
        }
      } catch (err) {
        logger.error('session:join error', err);
        socket.emit('session:error', { message: 'Failed to join session' });
      }
    });

    socket.on('disconnect', () => {
      // Only delete if this socket is the current one for this user (handles tab duplication)
      if (userSocketMap.get(String(socket.userId)) === socket.id) {
        userSocketMap.delete(socket.userId);
      }

      // Clean up joined sessions tracking
      joinedSockets.delete(socket.id);

      // Notify peers in all sessions this socket had joined
      if (socket.joinedSessionIds) {
        for (const sid of socket.joinedSessionIds) {
          const participants = sessionParticipants.get(sid);
          if (participants) {
            participants.delete(String(socket.userId));
            if (participants.size === 0) {
              sessionParticipants.delete(sid);
            }
          }
          socket.to(`session:${sid}`).emit('session:peer-left', {
            sessionId: sid,
            userId: socket.userId,
          });
        }
      }
    });

    // WebRTC signaling relay: clients send messages with { targetUserId, payload }
    socket.on('webrtc:offer', ({ targetUserId, offer }) => {
      const to = userSocketMap.get(String(targetUserId));
      if (to) {
        logger.info(`Offer relayed from ${socket.userId} to ${targetUserId}`);
        io.to(to).emit('webrtc:offer', { fromUserId: socket.userId, offer });
      }
    });

    socket.on('webrtc:answer', ({ targetUserId, answer }) => {
      const to = userSocketMap.get(String(targetUserId));
      if (to) {
        logger.info(`Answer relayed from ${socket.userId} to ${targetUserId}`);
        io.to(to).emit('webrtc:answer', { fromUserId: socket.userId, answer });
      }
    });

    socket.on('webrtc:ice', ({ targetUserId, candidate }) => {
      const to = userSocketMap.get(String(targetUserId));
      if (to) {
        logger.info(`ICE relayed from ${socket.userId} to ${targetUserId}`);
        io.to(to).emit('webrtc:ice', { fromUserId: socket.userId, candidate });
      }
    });
  });

  return io;
};

// Push a realtime notification to a specific user if they're online
const emitToUser = (userId, event, payload) => {
  const socketId = userSocketMap.get(String(userId));
  if (socketId && io) {
    io.to(socketId).emit(event, payload);
  }
};

// Broadcast to every connected client — used for things like "a new forum
// post was created" where any listening dashboard (volunteer/admin) should
// pick it up live rather than needing a per-user notification.
const broadcastEvent = (event, payload) => {
  if (io) io.emit(event, payload);
};

module.exports = { initSocket, emitToUser, broadcastEvent };