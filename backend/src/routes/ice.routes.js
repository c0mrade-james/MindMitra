const express = require('express');
const https = require('https');
const env = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

let cachedIceServers = null;
let cacheTimestamp = 0;
const CACHE_TTL = 50 * 1000;

// Free STUN servers (minimal set — UDP often blocked, TURN is more reliable)
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

// Free TURN servers from Open Relay — TCP/TLS first (UDP blocked on many networks)
const OPEN_RELAY_TURN = [
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
];

// Baseline: Open Relay TURN (TCP/TLS first) + STUN
const BASELINE_ICE_SERVERS = [...OPEN_RELAY_TURN, ...STUN_SERVERS];

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse error: ${data.substring(0, 500)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// Fetch TURN credentials from Xirsys
async function fetchXirsysTurn() {
  const { ident, secret, channel } = env.xirsys;
  if (!ident || !secret || !channel) {
    throw new Error('Xirsys credentials not configured');
  }

  const auth = Buffer.from(`${ident}:${secret}`).toString('base64');
  const encodedChannel = encodeURIComponent(channel);

  const response = await httpsRequest({
    hostname: 'global.xirsys.net',
    path: `/_turn/${encodedChannel}?webrtc=1&expire=120`,
    method: 'PUT',
    headers: {
      Authorization: `Basic ${auth}`,
    },
    timeout: 10000,
  });

  if (response.s !== 'ok') {
    throw new Error(`Xirsys API error: ${response.s}`);
  }

  // Split single ICE server (with multiple URLs) into individual objects
  // Priority: TCP/TLS first (UDP often blocked on restrictive networks)
  const raw = response.v.iceServers;
  const split = [];
  for (const server of raw) {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    for (const url of urls) {
      split.push({
        urls: url,
        ...(server.username && { username: server.username }),
        ...(server.credential && { credential: server.credential }),
      });
    }
  }
  // Sort: TLS (turns) first, then TCP, then UDP last
  split.sort((a, b) => {
    const u = (s) => String(s.urls);
    const priority = (s) => {
      const url = u(s);
      if (url.startsWith('turns:')) return 0; // TLS first
      if (url.includes('transport=tcp')) return 1; // TCP second
      if (url.startsWith('turn:')) return 2; // UDP last
      return 3; // STUN
    };
    return priority(a) - priority(b);
  });
  return split;
}

// Test endpoint — open in browser to check Xirsys config
router.get('/test', async (_req, res) => {
  const { ident, secret, channel } = env.xirsys;
  if (!ident || !secret || !channel) {
    return res.json({ ok: false, error: 'XIRSYS_USERNAME, XIRSYS_API_KEY, or XIRSYS_CHANNEL not set on Render' });
  }
  try {
    const iceServers = await fetchXirsysTurn();
    return res.json({ ok: true, ident: ident.substring(0, 5) + '...', channel, iceServerCount: iceServers.length, iceServers });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

router.get('/', async (_req, res) => {
  try {
    if (cachedIceServers && Date.now() - cacheTimestamp < CACHE_TTL) {
      return res.json({ success: true, data: cachedIceServers });
    }

    // Try Xirsys first if configured
    if (env.xirsys.ident && env.xirsys.secret && env.xirsys.channel) {
      try {
        logger.info(`Fetching Xirsys TURN for channel: ${env.xirsys.channel}`);
        const turnServers = await fetchXirsysTurn();

        if (turnServers && turnServers.length > 0) {
          // Priority: Xirsys TCP/TLS first, Open Relay TCP, STUN last
          const iceServers = [...turnServers, ...OPEN_RELAY_TURN, ...STUN_SERVERS];
          cachedIceServers = iceServers;
          cacheTimestamp = Date.now();
          logger.info(`Xirsys TURN success: ${turnServers.length} servers (TCP/TLS prioritized)`);
          return res.json({ success: true, data: iceServers });
        }

        logger.warn('Xirsys returned no servers');
      } catch (err) {
        logger.warn('Xirsys TURN failed:', err.message);
      }
    }

    // Fallback: STUN + Open Relay TURN (always works, no config needed)
    logger.info('Using baseline STUN + Open Relay TURN servers');
    cachedIceServers = BASELINE_ICE_SERVERS;
    cacheTimestamp = Date.now();
    return res.json({ success: true, data: BASELINE_ICE_SERVERS });
  } catch (err) {
    logger.error('ICE servers error:', err.message);
    return res.json({ success: true, data: BASELINE_ICE_SERVERS });
  }
});

module.exports = router;
