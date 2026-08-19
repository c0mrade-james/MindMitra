const express = require('express');
const controller = require('../controllers/chat.controller');
const verifyJWT = require('../middlewares/auth.middleware');
const { chatLimiter } = require('../middlewares/rateLimiter.middleware');

const router = express.Router();
router.use(verifyJWT);

router.post('/message', chatLimiter, controller.sendMessage);
router.post('/stream', chatLimiter, controller.streamMessage);
router.get('/history/:sessionId', controller.getHistory);
router.get('/sessions', controller.getSessions);

module.exports = router;
