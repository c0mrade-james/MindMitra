const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');

let io;
const userSocketMap = new Map(); // userId -> socketId
const sessionReadyRooms = new Set();

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: env.clientUrl, credentials: true },
  });

  // Configure ICE servers if provided in env
  try {
    const iceRaw = env.iceServers;
    if (iceRaw) {
      // parse JSON array from env if present
      const parsed = JSON.parse(iceRaw);
      io._iceServers = parsed; // store for reference; not a standard field but useful for debugging
      logger.info('Configured custom ICE servers for WebRTC');
    }
  } catch (err) {
    logger.warn('Failed to parse ICE_SERVERS env var');
  }

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

        socket.join(`session:${sessionId}`);
        logger.info(`Session joined: user ${uid} joined room session:${sessionId}`);
        socket.emit('session:joined', { sessionId });

        const clients = await io.in(`session:${sessionId}`).fetchSockets();
        const participantCount = clients.filter((s) => {
          const user = String(s.userId);
          return user === studentId || user === counselorId;
        }).length;

        if (participantCount === 2 && !sessionReadyRooms.has(sessionId)) {
          sessionReadyRooms.add(sessionId);
          logger.info(`Session ready: session:${sessionId}`);
          io.in(`session:${sessionId}`).emit('session:ready', { sessionId });
        }
      } catch (err) {
        logger.error('session:join error', err);
        socket.emit('session:error', { message: 'Failed to join session' });
      }
    });

    socket.on('disconnect', () => {
      userSocketMap.delete(socket.userId);
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