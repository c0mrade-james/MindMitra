const { StatusCodes } = require('http-status-codes');
const crypto = require('crypto');
const ChatHistory = require('../models/ChatHistory.model');
const EmergencyAlert = require('../models/EmergencyAlert.model');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { getChatReply, getChatReplyStream } = require('../services/chat.service');
const logger = require('../utils/logger');

const sendMessage = asyncHandler(async (req, res) => {
  const { message, sessionId } = req.body;
  const activeSessionId = sessionId || crypto.randomUUID();

  let chat = await ChatHistory.findOne({ user: req.user._id, sessionId: activeSessionId });
  if (!chat) {
    chat = await ChatHistory.create({ user: req.user._id, sessionId: activeSessionId, messages: [] });
  }

  const { reply, emergency } = await getChatReply(message, chat.messages);

  chat.messages.push({ role: 'user', content: message, flagged: emergency });
  chat.messages.push({ role: 'ai', content: reply });
  if (emergency) chat.emergencyTriggered = true;
  await chat.save();

  if (emergency) {
    await EmergencyAlert.create({
      user: req.user._id,
      triggerSource: 'chatbot',
      triggerContext: message.slice(0, 300),
    });
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, { sessionId: activeSessionId, reply, emergency }, 'Message sent'));
});

const streamMessage = async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const activeSessionId = sessionId || crypto.randomUUID();

    let chat = await ChatHistory.findOne({ user: req.user._id, sessionId: activeSessionId });
    if (!chat) {
      chat = await ChatHistory.create({ user: req.user._id, sessionId: activeSessionId, messages: [] });
    }

    // Detect emergency before streaming so the frontend knows immediately
    const emergency = require('../utils/constants').detectEmergency(message);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial event with metadata
    res.write(`data: ${JSON.stringify({ type: 'start', sessionId: activeSessionId, emergency })}\n\n`);

    if (emergency) {
      await EmergencyAlert.create({
        user: req.user._id,
        triggerSource: 'chatbot',
        triggerContext: message.slice(0, 300),
      });
    }

    // Stream the AI response
    let fullReply = '';
    for await (const event of getChatReplyStream(message, chat.messages)) {
      if (event.done) {
        fullReply = event.fullReply || fullReply;
        break;
      }
      fullReply += event.chunk;
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: event.chunk })}\n\n`);
    }

    // Save the complete message to DB
    chat.messages.push({ role: 'user', content: message, flagged: emergency });
    chat.messages.push({ role: 'ai', content: fullReply });
    if (emergency) chat.emergencyTriggered = true;
    await chat.save();

    // Send completion event
    res.write(`data: ${JSON.stringify({ type: 'done', emergency })}\n\n`);
    res.end();
  } catch (err) {
    logger.error('Stream controller error', err.message);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
};

const getHistory = asyncHandler(async (req, res) => {
  const chat = await ChatHistory.findOne({ user: req.user._id, sessionId: req.params.sessionId });
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, chat || { messages: [] }, 'Chat history fetched'));
});

const getSessions = asyncHandler(async (req, res) => {
  const sessions = await ChatHistory.find({ user: req.user._id })
    .select('sessionId createdAt updatedAt emergencyTriggered messages')
    .sort({ updatedAt: -1 });
  const summarized = sessions.map((s) => ({
    sessionId: s.sessionId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    emergencyTriggered: s.emergencyTriggered,
    lastMessage: s.messages[s.messages.length - 1]?.content?.slice(0, 80) || '',
  }));
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, summarized, 'Sessions fetched'));
});

module.exports = { sendMessage, streamMessage, getHistory, getSessions };
