// 商机嗅探器 MVP v0.3 · 零依赖 Node 服务（node:http）
// 广场层 + 行业裂变图谱为核心主闭环；本地经验模块独立路由解耦
// 用法：node src/server.js [--port 7100] [--host 127.0.0.1] [--data-dir path]；亦读 PORT/HOST/DATA_DIR 环境变量
const http = require('http');
const fs = require('fs');
const path = require('path');

const defaultSeed = require('./seed.js');
const { HttpError, MIME_TYPES, send, safeDecode } = require('./http-utils');
const { createGraphStore } = require('./graph-store');
const { createExperienceStore } = require('./experience-store');
const { createDeskStore } = require('./desk-store');
const { createRadarBridge } = require('./radar-bridge');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(ROOT, 'data');
const DEFAULT_STATIC_DIR = path.join(__dirname, 'static');

function argVal(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/**
 * Parse request URL safely without trusting malformed Host headers.
 * @param {import('http').IncomingMessage} req
 * @returns {URL}
 */
function parseRequestUrl(req) {
  const rawHost = typeof req.headers.host === 'string' ? req.headers.host : '';
  const safeHost = /^[a-zA-Z0-9.\[\]-]+(:\d{1,5})?$/.test(rawHost) ? rawHost : 'localhost';
  try {
    return new URL(req.url || '/', 'http://' + safeHost);
  } catch (_) {
    throw new HttpError(400, '请求地址非法');
  }
}

/**
 * Serve static files from `staticDir` with strict directory-boundary containment.
 * @param {import('http').ServerResponse} res
 * @param {string} staticDir
 * @param {string} pathname
 */
function serveStatic(res, staticDir, pathname) {
  const relRaw = safeDecode(pathname === '/' ? '/index.html' : pathname).replace(/^\/+/, '');
  if (relRaw.includes('\0')) {
    send(res, 400, { error: '请求路径非法' });
    return true;
  }
  const abs = path.resolve(staticDir, relRaw || 'index.html');
  const rootWithSep = staticDir.endsWith(path.sep) ? staticDir : staticDir + path.sep;
  if (abs !== staticDir && !abs.startsWith(rootWithSep)) {
    send(res, 403, { error: 'forbidden' });
    return true;
  }
  if (!fs.existsSync(abs)) return false;
  const stat = fs.statSync(abs);
  if (!stat.isFile()) return false;

  const contentType = MIME_TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
  const stream = fs.createReadStream(abs);
  stream.on('error', () => {
    if (!res.headersSent) {
      send(res, 500, { error: 'static read error' });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
  return true;
}

/**
 * Create a decoupled HTTP server instance suitable for both production and isolated tests.
 * @param {{ dataDir?: string, staticDir?: string, seed?: typeof defaultSeed }} [options]
 */
function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
  const staticDir = path.resolve(options.staticDir || DEFAULT_STATIC_DIR);
  const graphStore = createGraphStore({ dataDir, seed: options.seed || defaultSeed });
  const experienceStore = createExperienceStore({ dataDir });
  const deskStore = createDeskStore({ dataDir });
  const radarBridge = createRadarBridge({ dataDir, radarDir: options.radarDir, pythonBin: options.pythonBin });

  const server = http.createServer(async (req, res) => {
    try {
      const url = parseRequestUrl(req);
      if (await graphStore.handle(req, res, url)) return;
      if (await experienceStore.handle(req, res, url)) return;
      if (await deskStore.handle(req, res, url)) return;
      if (await radarBridge.handle(req, res, url)) return;
      if (req.method === 'GET' && serveStatic(res, staticDir, url.pathname)) return;
      send(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return;
      }
      send(res, 500, { error: 'server error: ' + err.message });
    }
  });

  return { server, dataDir, staticDir, graphStore, experienceStore, deskStore, radarBridge };
}

if (require.main === module) {
  const port = parseInt(argVal('port') || process.env.PORT || '7100', 10);
  const host = argVal('host') || process.env.HOST || '127.0.0.1';
  const dataDir = argVal('data-dir') || process.env.DATA_DIR || DEFAULT_DATA_DIR;
  const app = createApp({ dataDir });
  app.server.listen(port, host, () => {
    console.log(`商机嗅探器 MVP 已启动: http://${host}:${port}（版本见 VERSION 文件）`);
    console.log(`数据文件: ${path.join(app.dataDir, 'graph.json')}`);
  });
}

module.exports = {
  createApp,
  parseRequestUrl,
  serveStatic,
};
