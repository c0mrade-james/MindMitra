const express = require('express');
const https = require('https');
const env = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

let cachedIceServers = null;
let cacheTimestamp = 0;
const CACHE_TTL = 20 * 60 * 1000;

// Free STUN servers (always available)
const STUN_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

// Free TURN servers from Open Relay — no API key, no signup
const OPEN_RELAY_TURN = [
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// Always return STUN + Open Relay TURN as baseline (guaranteed free, no config needed)
const BASELINE_ICE_SERVERS = [...STUN_SERVERS, ...OPEN_RELAY_TURN];

function postJson(url, body, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse error: ${data.substring(0, 500)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

router.get('/', async (_req, res) => {
  try {
    if (cachedIceServers && Date.now() - cacheTimestamp < CACHE_TTL) {
      return res.json({ success: true, data: cachedIceServers });
    }

    const { accountId, apiToken } = env.cloudflare;

    // Try Cloudflare TURN first if configured
    if (accountId && apiToken) {
      try {
        logger.info(`Fetching Cloudflare TURN for account: ${accountId.substring(0, 8)}...`);
        const response = await postJson(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/calls/turn/credentials`,
          { ttl: 86400 },
          { Authorization: `Bearer ${apiToken}` }
        );

        if (response.success && response.result?.iceServers?.length > 0) {
          const turnServers = response.result.iceServers;
          const iceServers = [...STUN_SERVERS, ...turnServers];
          cachedIceServers = iceServers;
          cacheTimestamp = Date.now();
          logger.info(`Cloudflare TURN success: ${turnServers.length} servers`);
          return res.json({ success: true, data: iceServers });
        }

        logger.warn('Cloudflare TURN returned no servers:', JSON.stringify(response.errors || response).substring(0, 200));
      } catch (err) {
        logger.warn('Cloudflare TURN failed:', err.message);
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
