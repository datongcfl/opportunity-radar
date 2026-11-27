const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { clip, readBody, send, safeDecode } = require('./http-utils');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;
const CLAIM_CATEGORIES = new Set(['pricing', 'cac', 'demand', 'delivery', 'compliance']);

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJsonAtomic(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
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

function extractKeywords(text, fallback) {
  const raw = String(text || '').replace(/[()（）【】\[\]：:，,、。；;!?！？/\\|·—\-+]+/g, ' ');
  const tokens = raw.split(/\s+/).map(s => s.trim()).filter(s => s.length >= 2).slice(0, 6);
  if (tokens.length) return Array.from(new Set(tokens));
  return [clip(fallback, 24) || '核心业务'];
}

function slugifyTitle(title) {
  const ascii = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 26);
  if (ascii && SLUG_RE.test(ascii)) return ascii;
  return 'desk-' + Date.now().toString(36).slice(-6);
}

/**
 * Translate a Spatial Desk origin + child branch cards into a schema-valid `radar` pack.json.
 */
function buildPackFromDeskTree({ slug, title, originNode, branchNodes = [], githubQueries = [] }) {
  const cleanTitle = clip(title || (originNode && originNode.title) || slug, 48);
  const activeBranches = (Array.isArray(branchNodes) ? branchNodes : [])
    .filter(n => n && n.title && n.status !== 'falsified');

  const moduleNodes = activeBranches.filter(n => n.type !== 'scenario' && n.type !== 'origin');
  const scenarioNodes = activeBranches.filter(n => n.type === 'scenario');

  const modules = moduleNodes.length
    ? moduleNodes.slice(0, 12).map((n, i) => ({
        id: 'M' + String(i + 1).padStart(2, '0'),
        name: clip(n.title, 36),
        artifacts: [clip(n.firstStep || n.earn || n.title, 36)],
        keywords: extractKeywords(`${n.title} ${n.summary || ''} ${n.barrier || ''}`, n.title),
      }))
    : [
        { id: 'M01', name: '需求痛点与获客渠道', artifacts: ['获客漏斗', '客户访谈'], keywords: extractKeywords(cleanTitle + ' 需求 获客 渠道', cleanTitle) },
        { id: 'M02', name: '变现定价与毛利结构', artifacts: ['报价单', '收费模型'], keywords: extractKeywords(cleanTitle + ' 定价 收费 订阅 billing pricing', cleanTitle) },
        { id: 'M03', name: '核心交付与效率工具', artifacts: ['交付SOP', '自动化工具'], keywords: extractKeywords(cleanTitle + ' 交付 流程 工具 workflow management', cleanTitle) },
        { id: 'M04', name: '合规边界与风控机制', artifacts: ['服务协议', '合规清单'], keywords: extractKeywords(cleanTitle + ' 合规 风险 标准 standard compliance', cleanTitle) },
      ];

  const subsystems = scenarioNodes.length
    ? scenarioNodes.slice(0, 8).map((n, i) => ({
        id: 'S' + String(i + 1).padStart(2, '0'),
        name: clip(n.title, 36),
        artifacts: [clip(n.firstStep || n.title, 36)],
        keywords: extractKeywords(`${n.title} ${n.summary || ''}`, n.title),
      }))
    : [
        {
          id: 'S01',
          name: clip((originNode && originNode.cat) ? `${originNode.cat}核心场景` : `${cleanTitle}主场景`, 36),
          artifacts: ['最小闭环样板单'],
          keywords: extractKeywords(`${cleanTitle} ${(originNode && originNode.summary) || ''}`, cleanTitle),
        },
      ];

  const defaultGh = Array.isArray(githubQueries) && githubQueries.length
    ? githubQueries.map(q => clip(q, 80)).filter(Boolean).slice(0, 3)
    : [
        `${cleanTitle} in:readme`,
        `${cleanTitle} 管理 系统 in:readme`,
      ];

  return {
    schema_version: 1,
    pack: slug,
    version: '0.1.0',
    title: cleanTitle,
    aliases: [cleanTitle, (originNode && originNode.cat) || ''].filter(Boolean),
    modules,
    subsystems,
    source_map: {
      github: defaultGh,
      web: [`${cleanTitle} 流程 报价 规范`, `${cleanTitle} 管理系统 需求`],
    },
    query_templates: [
      '{industry} {module} 报价 流程',
      '{subsystem} 痛点 案例',
      '{industry} {artifact} 规范',
    ],
  };
}

/**
 * Bridge `opportunity-radar` to the zero-dependency Python `radar` engine.
 * Supports packs, live runs, one-click canvas probes, URL drafting, and rule-based commercial claims.
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

  function childEnv() {
    return { ...process.env, PYTHONIOENCODING: 'utf-8', GITHUB_TOKEN: '' };
  }

  function runPython(args, timeout = 90000) {
    return new Promise((resolve, reject) => {
      if (!isEngineAvailable()) {
        reject(new Error('未找到同级 radar 引擎目录: ' + resolvedRadarDir));
        return;
      }
      execFile(pyCmd, args, { cwd: resolvedRadarDir, env: childEnv(), timeout }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || err.message || 'radar 执行失败').trim().slice(0, 400)));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  function resolvePackFiles(slug) {
    if (!SLUG_RE.test(slug)) return null;
    const wsPack = path.join(workspaceDir, 'packs', slug, 'pack.json');
    const wsSeeds = path.join(workspaceDir, 'seeds', slug + '.json');
    if (fs.existsSync(wsPack) && fs.existsSync(wsSeeds)) {
      return { slug, source: 'workspace', packFile: wsPack, seedsFile: wsSeeds };
    }
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

  function loadClaimsDetail(slug) {
    const inputPath = path.join(workspaceDir, 'claims', slug + '.json');
    const evalPath = path.join(localRunsDir, slug, 'claims', 'claims.json');
    const fallbackEval = path.join(resolvedRadarDir, 'runs', slug + '-claims', 'claims.json');

    const input = readJsonSafe(inputPath);
    const evaluated = readJsonSafe(evalPath) || readJsonSafe(fallbackEval);
    const items = (evaluated && Array.isArray(evaluated.claims)) ? evaluated.claims : [];
    const summary = {
      total: items.length,
      high: items.filter(c => c.label === 'high').length,
      medium: items.filter(c => c.label === 'medium').length,
      low: items.filter(c => c.label === 'low').length,
      contested: items.filter(c => c.status === 'contested').length,
    };
    return {
      pack: slug,
      hasClaims: items.length > 0,
      input: input || { schema_version: 1, pack: slug, claims: [] },
      evaluated,
      claims: items,
      summary,
    };
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
      const claimsInfo = loadClaimsDetail(slug);

      items.push({
        pack: slug,
        title: spec.title || slug,
        source: files.source,
        moduleCount: Array.isArray(spec.modules) ? spec.modules.length : 0,
        subsystemCount: Array.isArray(spec.subsystems) ? spec.subsystems.length : 0,
        hasRun: !!cov,
        sourcesCount: cov ? cov.sources : 0,
        summary: cov ? cov.summary : null,
        claimsSummary: claimsInfo.summary,
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
    const claimsInfo = loadClaimsDetail(slug);
    if (!runDir) {
      return {
        pack: slug, packSpec, hasRun: false, state: null, coverage: null,
        sources: [], gapsMarkdown: '', claims: claimsInfo,
      };
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
      claims: claimsInfo,
    };
  }

  async function execRadarRun(slug, { title, github = false, web = false, verifyQuotes = false } = {}) {
    const files = resolvePackFiles(slug);
    if (!files) throw new Error('未找到对应的 radar pack 或 seeds: ' + slug);
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
    if (github) args.push('--github', '--limit', '3', '--max-queries', '2');
    if (web) args.push('--web');
    if (verifyQuotes) args.push('--verify-quotes');

    const { stdout } = await runPython(args, 90000);
    // Re-evaluate claims automatically if a claims ledger exists for this pack
    const claimsInputPath = path.join(workspaceDir, 'claims', slug + '.json');
    if (fs.existsSync(claimsInputPath)) {
      try {
        await execRadarClaims(slug);
      } catch (_) {}
    }
    return { stdout, detail: loadRunDetail(slug) };
  }

  async function execRadarClaims(slug) {
    const files = resolvePackFiles(slug);
    if (!files) throw new Error('未找到对应的 radar pack: ' + slug);
    const runDir = resolveRunDir(slug);
    if (!runDir) throw new Error('请先运行一次 radar 审计生成 sources.jsonl，再评估商业主张');
    const claimsFile = path.join(workspaceDir, 'claims', slug + '.json');
    if (!fs.existsSync(claimsFile)) throw new Error('尚未创建该分析包的商业主张文件');
    const outDir = path.join(localRunsDir, slug, 'claims');
    fs.mkdirSync(outDir, { recursive: true });

    await runPython([
      '-m', 'radar', 'claims',
      '--pack', files.packFile,
      '--run', runDir,
      '--claims', claimsFile,
      '--out', outDir,
    ], 30000);
    return loadClaimsDetail(slug);
  }

  async function draftUrlsIntoPack(slug, urls, covers = null) {
    const files = resolvePackFiles(slug);
    if (!files) throw new Error('未找到对应的 radar pack: ' + slug);

    // Promote external pack/seeds into workspace before appending new URLs so sibling radar repo stays untouched
    const wsPack = path.join(workspaceDir, 'packs', slug, 'pack.json');
    const wsSeeds = path.join(workspaceDir, 'seeds', slug + '.json');
    if (files.source !== 'workspace') {
      writeJsonAtomic(wsPack, readJsonSafe(files.packFile));
      writeJsonAtomic(wsSeeds, readJsonSafe(files.seedsFile));
    }

    const draftOut = path.join(workspaceDir, 'seeds', slug + '.draft.tmp.json');
    const args = ['-m', 'radar', 'draft', '--pack', wsPack, '--seeds', wsSeeds, '--out', draftOut];
    if (covers && covers.length) args.push('--covers', covers.join(','));
    for (const u of urls) args.push('--url', u);

    const { stdout } = await runPython(args, 60000);
    const draftData = readJsonSafe(draftOut);
    try { fs.unlinkSync(draftOut); } catch (_) {}

    const existing = readJsonSafe(wsSeeds) || { schema_version: 1, pack: slug, sources: [] };
    const newSources = (draftData && Array.isArray(draftData.sources)) ? draftData.sources : [];
    // Remove unreachable probe placeholder once real sources arrive
    const keptExisting = newSources.length
      ? (existing.sources || []).filter(s => s.id !== 'PROBE-000')
      : (existing.sources || []);
    for (const s of newSources) {
      if (s.quotes && s.quotes.length) s.status = 'selected';
      keptExisting.push(s);
    }
    writeJsonAtomic(wsSeeds, { schema_version: 1, pack: slug, sources: keptExisting });

    const runRes = await execRadarRun(slug, { web: newSources.length > 0, verifyQuotes: newSources.length > 0 });
    return { draftSummary: stdout, added: newSources.length, detail: runRes.detail };
  }

  async function createProbeFromCanvas(body) {
    const rawSlug = clip(body.slug, 38).toLowerCase();
    const slug = SLUG_RE.test(rawSlug) ? rawSlug : slugifyTitle(body.title || (body.originNode && body.originNode.title));
    const packObj = buildPackFromDeskTree({
      slug,
      title: body.title,
      originNode: body.originNode,
      branchNodes: body.branchNodes,
      githubQueries: body.githubQueries,
    });

    const wsPack = path.join(workspaceDir, 'packs', slug, 'pack.json');
    const wsSeeds = path.join(workspaceDir, 'seeds', slug + '.json');
    writeJsonAtomic(wsPack, packObj);

    const seedUrls = Array.isArray(body.seedUrls)
      ? body.seedUrls.map(u => String(u || '').trim()).filter(u => /^https?:\/\//.test(u)).slice(0, 8)
      : [];
    const runGithub = body.runGithub !== false;

    // Seed with either real drafted URLs or an explicit unreachable placeholder (honest 0-evidence baseline)
    const fallbackPlaceholder = {
      id: 'PROBE-000',
      platform: 'web',
      url: 'https://example.invalid/probe-baseline',
      title: '首轮自动探针占位（尚未收录人工核验 URL）',
      artifact_type: 'docs',
      access_status: 'unreachable',
      license: 'unknown',
      license_status: 'needs_review',
      evidence_level: 'marketing',
      covers: [packObj.modules[0].id],
      quotes: [],
      status: 'rejected',
      why_selected: '无初始 URL 时的零证据基线占位；status=rejected 在 radar 中严格记为 none（0 来源），不会虚报证据。',
    };
    writeJsonAtomic(wsSeeds, { schema_version: 1, pack: slug, sources: [fallbackPlaceholder] });

    let addedFromUrls = 0;
    if (seedUrls.length) {
      const draftRes = await draftUrlsIntoPack(slug, seedUrls);
      addedFromUrls = draftRes.added;
    }

    const runRes = await execRadarRun(slug, {
      title: packObj.title,
      github: runGithub,
      web: addedFromUrls > 0,
      verifyQuotes: runGithub || addedFromUrls > 0,
    });
    return { pack: slug, addedFromUrls, detail: runRes.detail };
  }

  async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/radar/packs') {
      send(res, 200, { available: isEngineAvailable(), packs: listAllPacks() });
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
          github: !!b.github,
          web: !!b.web,
          verifyQuotes: !!b.verifyQuotes,
        });
        send(res, 200, result.detail);
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/radar/probe') {
      const b = await readBody(req, 131072);
      const title = clip(b.title || (b.originNode && b.originNode.title), 48);
      if (!title) {
        send(res, 400, { error: '生成探针必须提供行业标题' });
        return true;
      }
      try {
        const result = await createProbeFromCanvas(b);
        send(res, 201, result);
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/radar/draft-urls') {
      const b = await readBody(req);
      const slug = clip(b.pack, 40);
      if (!SLUG_RE.test(slug)) {
        send(res, 400, { error: 'pack 标识格式非法' });
        return true;
      }
      const urls = Array.isArray(b.urls)
        ? b.urls.map(u => String(u || '').trim()).filter(u => /^https?:\/\//.test(u)).slice(0, 8)
        : [];
      if (!urls.length) {
        send(res, 400, { error: '请至少提供 1 条合法的 http(s) URL' });
        return true;
      }
      const covers = Array.isArray(b.covers) ? b.covers.map(c => clip(c, 8)).filter(Boolean) : null;
      try {
        const result = await draftUrlsIntoPack(slug, urls, covers);
        send(res, 200, result);
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/radar/claims/')) {
      const slug = safeDecode(url.pathname.slice('/api/radar/claims/'.length));
      if (!SLUG_RE.test(slug)) {
        send(res, 400, { error: 'pack 标识格式非法' });
        return true;
      }
      if (!resolvePackFiles(slug)) {
        send(res, 404, { error: '未找到该 radar pack' });
        return true;
      }
      send(res, 200, loadClaimsDetail(slug));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/radar/claims') {
      const b = await readBody(req);
      const slug = clip(b.pack, 40);
      if (!SLUG_RE.test(slug)) {
        send(res, 400, { error: 'pack 标识格式非法' });
        return true;
      }
      const files = resolvePackFiles(slug);
      if (!files) {
        send(res, 404, { error: '未找到该 radar pack' });
        return true;
      }

      const claimsFile = path.join(workspaceDir, 'claims', slug + '.json');
      let list = [];
      if (Array.isArray(b.claims)) {
        list = b.claims;
      } else if (b.addClaim && typeof b.addClaim === 'object') {
        const existing = readJsonSafe(claimsFile) || { schema_version: 1, pack: slug, claims: [] };
        list = Array.isArray(existing.claims) ? [...existing.claims] : [];
        const c = b.addClaim;
        const nextNum = list.length + 1;
        const cid = clip(c.id, 16) || ('C' + String(nextNum).padStart(3, '0'));
        const cat = CLAIM_CATEGORIES.has(c.category) ? c.category : 'pricing';
        list.push({
          id: cid,
          category: cat,
          metric: clip(c.metric, 40),
          statement: clip(c.statement, 240),
          covers: Array.isArray(c.covers) ? c.covers.map(x => clip(x, 8)).filter(Boolean) : [],
          sources: Array.isArray(c.sources) ? c.sources.map(x => clip(x, 24)).filter(Boolean) : [],
          contradicts: Array.isArray(c.contradicts) ? c.contradicts.map(x => clip(x, 16)).filter(Boolean) : [],
        });
      } else {
        send(res, 400, { error: '请提供 claims 数组或 addClaim 对象' });
        return true;
      }

      if (!list.length) {
        send(res, 400, { error: '商业主张列表不能为空' });
        return true;
      }

      const prevContent = fs.existsSync(claimsFile) ? fs.readFileSync(claimsFile, 'utf8') : null;
      writeJsonAtomic(claimsFile, { schema_version: 1, pack: slug, claims: list });
      try {
        const evaluated = await execRadarClaims(slug);
        send(res, 200, evaluated);
      } catch (err) {
        // Rollback invalid claims edit so workspace never stores broken schema
        if (prevContent !== null) fs.writeFileSync(claimsFile, prevContent, 'utf8');
        else { try { fs.unlinkSync(claimsFile); } catch (_) {} }
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
    loadClaimsDetail,
    execRadarRun,
    execRadarClaims,
    createProbeFromCanvas,
    handle,
  };
}

module.exports = {
  createRadarBridge,
  buildPackFromDeskTree,
};
