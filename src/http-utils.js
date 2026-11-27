const crypto = require('crypto');

class HttpError extends Error {
  /**
   * Typed HTTP error carrying status code for clean API error responses.
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
};

/**
 * Trim and truncate arbitrary input into a bounded string.
 * @param {unknown} value
 * @param {number} maxLen
 * @returns {string}
 */
function clip(value, maxLen) {
  return String(value == null ? '' : value).trim().slice(0, maxLen);
}

/**
 * Generate a collision-resistant identifier with a caller prefix.
 * @param {string} prefix
 * @returns {string}
 */
function uid(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

/**
 * Read and parse a JSON object request body with UTF-8 byte limit.
 * Rejects oversized payloads with 413 and malformed or non-object JSON with 400.
 * @param {import('http').IncomingMessage} req
 * @param {number} [maxBytes=65536]
 * @returns {Promise<Record<string, any>>}
 */
function readBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        req.pause();
        fail(new HttpError(413, '请求体过大'));
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        settled = true;
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          fail(new HttpError(400, '请求体必须为 JSON 对象'));
          return;
        }
        settled = true;
        resolve(parsed);
      } catch (_) {
        fail(new HttpError(400, '请求体必须是合法 JSON'));
      }
    });

    req.on('error', (err) => fail(err));
  });
}

/**
 * Write a JSON response with no-store cache headers.
 * @param {import('http').ServerResponse} res
 * @param {number} code
 * @param {unknown} payload
 */
function send(res, code, payload) {
  const buf = Buffer.from(JSON.stringify(payload), 'utf8');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (code === 413) headers.Connection = 'close';
  res.writeHead(code, headers);
  res.end(buf);
}

/**
 * Safely decode a URI segment, throwing HttpError(400) on malformed escapes.
 * @param {string} raw
 * @returns {string}
 */
function safeDecode(raw) {
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    throw new HttpError(400, 'URL 编码非法');
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Check whether a Host header value (host or host:port) points strictly to loopback.
 * @param {string} rawHost
 * @returns {boolean}
 */
function isLoopbackHost(rawHost) {
  const s = String(rawHost || '').trim().toLowerCase();
  if (!s || /\s|\//.test(s)) return false;
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) return false;
    const hostPart = s.slice(0, end + 1);
    const rest = s.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return false;
    return hostPart === '[::1]';
  }
  const idx = s.lastIndexOf(':');
  const hostPart = idx >= 0 && /^\d{1,5}$/.test(s.slice(idx + 1)) ? s.slice(0, idx) : s;
  return LOOPBACK_HOSTS.has(hostPart);
}

/**
 * Enforce local-only Host/Origin/Sec-Fetch-Site and JSON Content-Type guards against CSRF & DNS rebinding.
 * @param {import('http').IncomingMessage} req
 * @param {{ allowPublic?: boolean }} [options]
 */
function guardLocalRequest(req, { allowPublic = false } = {}) {
  const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : '';
  if (!allowPublic && hostHeader && !isLoopbackHost(hostHeader)) {
    throw new HttpError(403, '拒绝非本地 Host 访问（防 DNS rebinding）');
  }

  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (!allowPublic && originHeader) {
    let parsedOrigin = null;
    try {
      parsedOrigin = new URL(originHeader);
    } catch (_) {
      throw new HttpError(403, '拒绝非法 Origin 请求');
    }
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || !isLoopbackHost(parsedOrigin.host)) {
      throw new HttpError(403, '拒绝跨源 Origin 请求');
    }
  }

  const fetchSite = typeof req.headers['sec-fetch-site'] === 'string'
    ? req.headers['sec-fetch-site'].trim().toLowerCase()
    : '';
  if (!allowPublic && fetchSite === 'cross-site') {
    throw new HttpError(403, '拒绝跨站请求');
  }

  if (WRITE_METHODS.has(req.method)) {
    const ct = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'].trim().toLowerCase() : '';
    if (!ct.startsWith('application/json')) {
      throw new HttpError(415, '写操作仅接受 Content-Type: application/json');
    }
  }
}

module.exports = {
  HttpError,
  MIME_TYPES,
  clip,
  uid,
  readBody,
  send,
  safeDecode,
  isLoopbackHost,
  guardLocalRequest,
};
