const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { clip, readBody, send, safeDecode } = require('./http-utils');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readJsonlSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

/**
 * Bridge `opportunity-radar` to the zero-dependency Python `radar` engine.
 * Supports packs in `<dataDir>/radar-workspace` as well as sibling `<radarDir>`.
 * @param {{ dataDir: string, radarDir?: string, pythonBin?: string }} options
 */
function createRadarBridge({ dataDir, radarDir, pythonBin }) {
  const resolvedRadarDir = path.resolve(
    radarDir || process.env.RADAR_DIR || path.join(__dirname, '..', '..', 'radar')
  );
  const workspaceDir = path.join(dataDir, 'radar-workspace');
  const localRunsDir = path.join(dataDir, 'radar-runs');
  const pyCmd = pythonBin || process.env.PYTHON_BIN || 'python';

  function isEngineAvailable() {
    return fs.existsSync(path.join(resolvedRadarDir, 'radar', '__main__.py'));
  }

  function resolvePackFiles(slug) {
    if (!SLUG_RE.test(slug)) return null;
    // 1. Check local data/radar-workspace first
    const wsPack = path.join(workspaceDir, 'packs', slug, 'pack.json');
    const wsSeeds = path.join(workspaceDir, 'seeds', slug + '.json');
    if (fs.existsSync(wsPack) && fs.existsSync(wsSeeds)) {
      return { slug, source: 'workspace', packFile: wsPack, seedsFile: wsSeeds };
    }
    // 2. Check sibling radar repo
    const extPack = path.join(resolvedRadarDir, 'packs', slug, 'pack.json');
    const extSeeds = path.join(resolvedRadarDir, 'seeds', slug + '.json');
    if (fs.existsSync(extPack) && fs.existsSync(extSeeds)) {
      return { slug, source: 'radar', packFile: extPack, seedsFile: extSeeds };
    }
    return null;
  }

  function resolveRunDir(slug) {
    const localRun = path.join(localRunsDir, slug);
    if (fs.existsSync(path.join(localRun, 'coverage.json'))) return localRun;
    const demoRun = path.join(resolvedRadarDir, 'runs', slug + '-demo');
    if (fs.existsSync(path.join(demoRun, 'coverage.json'))) return demoRun;
    return null;
  }

  function listAllPacks() {
    const slugs = new Set();
    for (const root of [path.join(workspaceDir, 'packs'), path.join(resolvedRadarDir, 'packs')]) {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && SLUG_RE.test(entry.name)) slugs.add(entry.name);
      }
    }

    const items = [];
    for (const slug of Array.from(slugs).sort()) {
      const files = resolvePackFiles(slug);
      if (!files) continue;
      const spec = readJsonSafe(files.packFile);
      if (!spec) continue;
      const runDir = resolveRunDir(slug);
      const cov = runDir ? readJsonSafe(path.join(runDir, 'coverage.json')) : null;
      const st = runDir ? readJsonSafe(path.join(runDir, 'state.json')) : null;

      items.push({
        pack: slug,
        title: spec.title || slug,
        source: files.source,
        moduleCount: Array.isArray(spec.modules) ? spec.modules.length : 0,
        subsystemCount: Array.isArray(spec.subsystems) ? spec.subsystems.length : 0,
        hasRun: !!cov,
        sourcesCount: cov ? cov.sources : 0,
        summary: cov ? cov.summary : null,
        updatedAt: st ? st.created_at : null,
      });
    }
    return items;
  }

  function loadRunDetail(slug) {
    const files = resolvePackFiles(slug);
    if (!files) return null;
    const packSpec = readJsonSafe(files.packFile);
    const runDir = resolveRunDir(slug);
    if (!runDir) {
      return { pack: slug, packSpec, hasRun: false, state: null, coverage: null, sources: [], gapsMarkdown: '' };
    }
    const state = readJsonSafe(path.join(runDir, 'state.json'));
    const coverage = readJsonSafe(path.join(runDir, 'coverage.json'));
    const sources = readJsonlSafe(path.join(runDir, 'sources.jsonl'));
    let gapsMarkdown = '';
    try {
      const gp = path.join(runDir, 'gaps.md');
      if (fs.existsSync(gp)) gapsMarkdown = fs.readFileSync(gp, 'utf8');
    } catch (_) {}

    return {
      pack: slug,
      packSpec,
      hasRun: !!coverage,
      state,
      coverage,
      sources,
      gapsMarkdown,
    };
  }

  function execRadarRun(slug, { title, web = false, verifyQuotes = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!isEngineAvailable()) {
        reject(new Error('未找到同级 radar 引擎目录: ' + resolvedRadarDir));
        return;
      }
      const files = resolvePackFiles(slug);
      if (!files) {
        reject(new Error('未找到对应的 radar pack 或 seeds: ' + slug));
        return;
      }
      const spec = readJsonSafe(files.packFile) || {};
      const outDir = path.join(localRunsDir, slug);
      fs.mkdirSync(outDir, { recursive: true });

      const args = [
        '-m', 'radar', 'run',
        '--pack', files.packFile,
        '--seeds', files.seedsFile,
        '--title', clip(title || spec.title || slug, 60),
        '--out', outDir,
      ];
      if (web) args.push('--web');
      if (verifyQuotes) args.push('--verify-quotes');

      const childEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', GITHUB_TOKEN: '' };
      execFile(pyCmd, args, { cwd: resolvedRadarDir, env: childEnv, timeout: 90000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || err.message || 'radar 执行失败').trim().slice(0, 300)));
          return;
        }
        resolve({ stdout, detail: loadRunDetail(slug) });
      });
    });
  }

  async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/radar/packs') {
      send(res, 200, {
        available: isEngineAvailable(),
        packs: listAllPacks(),
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/radar/runs/')) {
      const slug = safeDecode(url.pathname.slice('/api/radar/runs/'.length));
      if (!SLUG_RE.test(slug)) {
        send(res, 400, { error: 'pack 标识格式非法' });
        return true;
      }
      const detail = loadRunDetail(slug);
      if (!detail) {
        send(res, 404, { error: '未找到该 radar pack' });
        return true;
      }
      send(res, 200, detail);
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/radar/run') {
      const b = await readBody(req);
      const slug = clip(b.pack, 40);
      if (!SLUG_RE.test(slug)) {
        send(res, 400, { error: 'pack 标识必填且只能含小写字母、数字和连字符' });
        return true;
      }
      try {
        const result = await execRadarRun(slug, {
          title: b.title,
          web: !!b.web,
          verifyQuotes: !!b.verifyQuotes,
        });
        send(res, 200, result.detail);
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return true;
    }

    return false;
  }

  return {
    isEngineAvailable,
    listAllPacks,
    loadRunDetail,
    execRadarRun,
    handle,
  };
}

module.exports = { createRadarBridge };
