const express = require('express');
const https = require('https');
const env = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

// In-memory cache for Cloudflare TURN credentials (valid for 24h, refresh early)
let cachedIceServers = null;
let cacheTimestamp = 0;
const CACHE_TTL = 20 * 60 * 1000; // refresh every 20 minutes

// Public STUN servers as always-available fallback
const STUN_FALLBACK = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

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
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error (status ${res.statusCode}): ${data.substring(0, 500)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// GET /api/v1/ice-servers — returns TURN credentials for WebRTC
router.get('/', async (_req, res) => {
  try {
    // Return cached credentials if still valid
    if (cachedIceServers && Date.now() - cacheTimestamp < CACHE_TTL) {
      logger.info('Returning cached ICE servers');
      return res.json({ success: true, data: cachedIceServers });
    }

    const { accountId, apiToken } = env.cloudflare;

    if (!accountId || !apiToken) {
      logger.warn('Cloudflare credentials not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)');
      return res.json({ success: true, data: STUN_FALLBACK });
    }

    logger.info(`Fetching Cloudflare TURN credentials for account: ${accountId.substring(0, 8)}...`);

    // Cloudflare Realtime TURN API — POST with TTL
    const response = await postJson(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/calls/turn/credentials`,
      { ttl: 86400 },
      { Authorization: `Bearer ${apiToken}` }
    );

    logger.info('Cloudflare API response:', JSON.stringify(response).substring(0, 300));

    if (!response.success) {
      const errMsg = response.errors?.[0]?.message || JSON.stringify(response.errors);
      logger.error('Cloudflare TURN API error:', errMsg);
      return res.json({ success: true, data: STUN_FALLBACK });
    }

    // Cloudflare returns { iceServers: [...] }
    const turnServers = response.result?.iceServers || [];
    logger.info(`Cloudflare returned ${turnServers.length} TURN servers:`, JSON.stringify(turnServers).substring(0, 500));

    // Combine STUN + TURN — STUN first for fast local connections
    const iceServers = [...STUN_FALLBACK, ...turnServers];

    // Cache the result
    cachedIceServers = iceServers;
    cacheTimestamp = Date.now();

    return res.json({ success: true, data: iceServers });
  } catch (err) {
    logger.error('Failed to fetch ICE servers:', err.message);
    return res.json({ success: true, data: STUN_FALLBACK });
  }
});

module.exports = router;
