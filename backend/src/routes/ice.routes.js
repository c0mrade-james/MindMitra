const express = require('express');
const https = require('https');
const env = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

// In-memory cache for Cloudflare TURN credentials (valid for 24h, refresh early)
let cachedIceServers = null;
let cacheTimestamp = 0;
const CACHE_TTL = 20 * 60 * 1000; // refresh every 20 minutes

// Cloudflare's free public STUN servers
const CF_STUN = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

function fetchJson(url, options = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.get(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: options.headers || {},
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse error: ${body.substring(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// GET /api/v1/ice-servers — returns TURN credentials for WebRTC
router.get('/', async (_req, res) => {
  try {
    // Return cached credentials if still valid
    if (cachedIceServers && Date.now() - cacheTimestamp < CACHE_TTL) {
      return res.json({ success: true, data: cachedIceServers });
    }

    const { accountId, apiToken } = env.cloudflare;

    if (!accountId || !apiToken) {
      logger.warn('Cloudflare credentials not configured, using STUN only');
      return res.json({ success: true, data: CF_STUN });
    }

    // Fetch temporary TURN credentials from Cloudflare Realtime API
    const response = await fetchJson(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/turn/credentials`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.success) {
      const errMsg = response.errors?.[0]?.message || 'Cloudflare API error';
      logger.error('Cloudflare TURN API error:', errMsg);
      // Fallback to STUN only
      return res.json({ success: true, data: CF_STUN });
    }

    // Cloudflare returns { iceServers: [...] } — combine with our STUN servers
    const turnServers = response.result?.iceServers || [];
    const iceServers = [...CF_STUN, ...turnServers];

    // Cache the result
    cachedIceServers = iceServers;
    cacheTimestamp = Date.now();

    logger.info(`Fetched ${turnServers.length} Cloudflare TURN servers`);
    return res.json({ success: true, data: iceServers });
  } catch (err) {
    logger.error('Failed to fetch ICE servers:', err.message);
    // Always fallback to STUN so the client gets something
    return res.json({ success: true, data: CF_STUN });
  }
});

module.exports = router;
