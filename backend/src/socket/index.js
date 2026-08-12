const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');

let io;
const userSocketMap = new Map(); // userId -> socketId (current live socket for that user)
// sessionId -> Set of userIds currently joined to that session's room.
// Tracking membership (not just a "ready" boolean) lets us detect a peer
// leaving and re-fire session:ready when they rejoin, instead of a call
// going permanently dead after a single reconnect.
const sessionParticipants = new Map();

// Default public STUN server plus any operator-supplied servers (including
// TURN, which is required for peers behind restrictive/symmetric NATs or
// corporate firewalls — STUN alone cannot traverse those). Previously
// ICE_SERVERS was parsed from env but only stashed on `io._iceServers` for
// debugging; it was never actually sent to clients, so custom/TURN servers
// had no effect and calls across such networks would silently fail to
// connect while still working fine on the same LAN or over localhost.
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// Metered issues short-lived, rotating TURN credentials via this API rather
// than a fixed username/password — safer than baking static creds into an
// env var, since anyone can read ICE candidates off the wire. We fetch
// server-side (the API key never reaches the browser) and cache briefly to
// avoid a network round trip on every session:join.
let meteredCache = { servers: null, fetchedAt: 0 };
const METERED_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

const fetchMeteredIceServers = async () => {
  const now = Date.now();
  if (meteredCache.servers && now - meteredCache.fetchedAt < METERED_CACHE_TTL_MS) {
    return meteredCache.servers;
  }

  const url = `https://${env.metered.domain}/api/v1/turn/credentials?apiKey=${env.metered.apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Metered credentials request failed: ${res.status}`);
  }
  const servers = await res.json();
  if (!Array.isArray(servers) || !servers.length) {
    throw new Error('Metered returned an empty credentials list');
  }
  meteredCache = { servers, fetchedAt: now };
  return servers;
};

// Static fallback: a raw JSON array of ICE servers (STUN and/or TURN with
// fixed long-lived credentials) supplied directly via env, for anyone not
// using Metered.
const getStaticIceServers = () => {
  if (!env.iceServers) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(env.iceServers);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_ICE_SERVERS;
  } catch (err) {
    logger.warn('Failed to parse ICE_SERVERS env var, falling back to default STUN');
    return DEFAULT_ICE_SERVERS;
  }
};

const getIceServers = async () => {
  if (env.metered.domain && env.metered.apiKey) {
    try {
      return await fetchMeteredIceServers();
    } catch (err) {
      logger.error('Failed to fetch Metered TURN credentials, falling back:', err.message);
    }
  }
  return getStaticIceServers();
};

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
    socket.joinedSessionIds = new Set();
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

        socket.join(`session:${sessionId}`);
        socket.joinedSessionIds.add(sessionId);
        logger.info(`Session joined: user ${uid} joined room session:${sessionId}`);
        socket.emit('session:joined', { sessionId, iceServers: await getIceServers() });

        if (!sessionParticipants.has(sessionId)) sessionParticipants.set(sessionId, new Set());
        sessionParticipants.get(sessionId).add(uid);
        const participantCount = sessionParticipants.get(sessionId).size;

        // Re-fire every time both participants are present — not just the
        // first time — so a peer who reconnects (network blip, refresh)
        // still triggers a fresh offer/answer exchange instead of leaving
        // the call permanently frozen.
        if (participantCount === 2) {
          logger.info(`Session ready: session:${sessionId}`);
          io.in(`session:${sessionId}`).emit('session:ready', { sessionId });
        }
      } catch (err) {
        logger.error('session:join error', err);
        socket.emit('session:error', { message: 'Failed to join session' });
      }
    });

    socket.on('disconnect', () => {
      // Only clear the mapping if it still points at this socket. If the
      // user already reconnected (new socket registered first), this
      // disconnect event fires for the *old* socket and must not wipe out
      // the live one — that race was silently breaking signaling relay to
      // reconnected users.
      if (userSocketMap.get(socket.userId) === socket.id) {
        userSocketMap.delete(socket.userId);
      }

      const uid = String(socket.userId);
      for (const sessionId of socket.joinedSessionIds) {
        const participants = sessionParticipants.get(sessionId);
        if (!participants) continue;
        participants.delete(uid);
        if (participants.size === 0) {
          sessionParticipants.delete(sessionId);
        } else {
          // Let the remaining participant know their peer dropped, so the
          // frontend can close/reset its RTCPeerConnection instead of
          // sitting on a frozen remote video with no explanation.
          io.in(`session:${sessionId}`).emit('session:peer-left', { sessionId });
        }
      }

      logger.info(`Socket disconnected: user ${socket.userId}`);
    });

    // WebRTC signaling relay: clients send messages with { targetUserId, payload }
    socket.on('webrtc:offer', ({ targetUserId, offer }) => {
      const to = userSocketMap.get(String(targetUserId));
      if (to) {
        logger.info(`Offer relayed from ${socket.userId} to ${targetUserId}`);
        io.to(to).emit('webrtc:offer', { fromUserId: socket.userId, offer });
      } else {
        logger.warn(`webrtc:offer dropped: target user ${targetUserId} is not connected`);
      }
    });

    socket.on('webrtc:answer', ({ targetUserId, answer }) => {
      const to = userSocketMap.get(String(targetUserId));
      if (to) {
        logger.info(`Answer relayed from ${socket.userId} to ${targetUserId}`);
        io.to(to).emit('webrtc:answer', { fromUserId: socket.userId, answer });
      } else {
        logger.warn(`webrtc:answer dropped: target user ${targetUserId} is not connected`);
      }
    });

    socket.on('webrtc:ice', ({ targetUserId, candidate }) => {
      const to = userSocketMap.get(String(targetUserId));
      if (to) {
        logger.info(`ICE relayed from ${socket.userId} to ${targetUserId}`);
        io.to(to).emit('webrtc:ice', { fromUserId: socket.userId, candidate });
      } else {
        logger.warn(`webrtc:ice dropped: target user ${targetUserId} is not connected`);
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