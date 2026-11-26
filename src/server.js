// 商机嗅探器 MVP v0.3 · 零依赖 Node 服务（node:http）
// 两层结构：广场层（行业原点集合，含 360 待认领种子）+ 行业层（以 origin 为根的裂变子图）
// 用法：node src/server.js [--port 7100] [--host 127.0.0.1]；亦读 PORT/HOST 环境变量
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'graph.json');
const SEED360_FILE = path.join(DATA_DIR, 'industries-360.json');
const EXTRA_FILE = path.join(DATA_DIR, 'industries-extra.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const EXP_FILE = path.join(DATA_DIR, 'experiences.json');
const STATIC_DIR = path.join(__dirname, 'static');
const seed = require('./seed.js');

// ---- 经验数据读写 ----
function loadExperiences() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EXP_FILE)) { fs.writeFileSync(EXP_FILE, '[]', 'utf8'); return []; }
  try { return JSON.parse(fs.readFileSync(EXP_FILE, 'utf8')); } catch (e) {
    // 文件损坏时先备份再重置，避免静默丢失全部数据；重置文件防止重复备份
    try {
      const badFile = EXP_FILE + '.bad-' + Date.now().toString(36);
      fs.copyFileSync(EXP_FILE, badFile);
      console.error('[experiences] JSON 文件损坏，已备份至 ' + path.basename(badFile) + '。请手动恢复后删除备份。');
    } catch (_) {}
    fs.writeFileSync(EXP_FILE, '[]', 'utf8');
    return [];
  }
}
function saveExperiences(list) {
  const tmp = EXP_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, EXP_FILE);
}

const EXP_CATEGORIES = new Set([
  '车管业务', '户籍业务', '社保公积金', '医疗健康', '教育入学',
  '房产相关', '营业执照', '税务相关', '司法公证', '其他办事'
]);

function argVal(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const PORT = parseInt(argVal('port') || process.env.PORT || '7100', 10);
const HOST = argVal('host') || process.env.HOST || '127.0.0.1';

// ---- meta（防止 360 种子重复灌）----
function loadMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch (e) { return { seeded360: false, seededExtra: false }; }
}
function saveMeta(m) {
  try { fs.writeFileSync(META_FILE, JSON.stringify(m, null, 2), 'utf8'); } catch (e) {}
}

// ---- 行业归属：从 origin 沿边 BFS 打标（含对旧数据的迁移）----
function stampIndustry(g) {
  const adj = {};
  for (const e of g.edges) (adj[e.source] = adj[e.source] || []).push(e.target);
  const origins = g.nodes.filter(n => n.type === 'origin');
  const owner = {};
  for (const o of origins) {
    if (owner[o.id]) continue;
    const q = [o.id]; owner[o.id] = o.id;
    while (q.length) {
      const cur = q.shift();
      for (const nx of adj[cur] || []) if (!owner[nx]) { owner[nx] = o.id; q.push(nx); }
    }
  }
  const dflt = origins[0] ? origins[0].id : null;
  for (const n of g.nodes) n.industry = n.industry || owner[n.id] || dflt;
  for (const e of g.edges) {
    if (!e.industry) {
      const s = g.nodes.find(n => n.id === e.source);
      e.industry = (s && s.industry) || dflt;
    }
  }
  return g;
}

// ---- 持久化（JSON 文件，原子写）----
function loadGraph() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const g = {
      nodes: seed.nodes.map(n => ({ ...n, marks: { did: 0, valid: 0, invalid: 0 }, createdAt: '2026-07-19T21:00:00+08:00' })),
      edges: seed.edges.map((e, i) => ({ id: 'se' + i, ...e, marks: { did: 0, valid: 0, invalid: 0 } })),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(stampIndustry(g), null, 2), 'utf8');
  }
  let g = stampIndustry(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  const before = g.nodes.length;
  g = seed360IfNeeded(g);
  if (g.nodes.length !== before) { g = stampIndustry(g); saveGraph(g); }
  const before2 = g.nodes.length;
  g = seedExtraIfNeeded(g);
  if (g.nodes.length !== before2) { g = stampIndustry(g); saveGraph(g); }
  return g;
}
function saveGraph(g) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(g, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

// ---- 360 行业种子：首次（seeded360=false 且种子文件存在）批量写入未认领原点 ----
function seed360IfNeeded(g) {
  const meta = loadMeta();
  if (meta.seeded360) return g;
  if (!fs.existsSync(SEED360_FILE)) { saveMeta(meta); return g; }
  let list = [];
  try { list = JSON.parse(fs.readFileSync(SEED360_FILE, 'utf8')); } catch (e) { saveMeta(meta); return g; }
  if (!Array.isArray(list) || list.length === 0) { saveMeta(meta); return g; }
  const now = new Date().toISOString();
  const existing = new Set(g.nodes.map(n => n.name));
  list.forEach((it, i) => {
    const name = String(it.name || '').trim();
    if (!name || existing.has(name)) return;
    const id = 'i36_' + String(i).padStart(3, '0');
    g.nodes.push({
      id, name, type: 'origin', visible: true, cat: it.cat || '', claimed: false,
      createdBy: '待认领', createdAt: now, industry: id, seedSource: '360',
      marks: { did: 0, valid: 0, invalid: 0 },
    });
  });
  meta.seeded360 = true;
  saveMeta(meta);
  return g;
}

// ---- 扩展行业种子：星云可见但列表不可见的 dormant 原点，发起后变为正式行业 ----
function seedExtraIfNeeded(g) {
  const meta = loadMeta();
  if (meta.seededExtra) return g;
  if (!fs.existsSync(EXTRA_FILE)) { meta.seededExtra = true; saveMeta(meta); return g; }
  let list = [];
  try { list = JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf8')); } catch (e) { meta.seededExtra = true; saveMeta(meta); return g; }
  if (!Array.isArray(list) || list.length === 0) { meta.seededExtra = true; saveMeta(meta); return g; }
  const now = new Date().toISOString();
  const existing = new Set(g.nodes.map(n => n.name));
  list.forEach((it, i) => {
    const name = String(it.name || '').trim();
    if (!name || existing.has(name)) return;
    const id = 'ix_' + String(i).padStart(3, '0');
    g.nodes.push({
      id, name, type: 'origin', visible: true, cat: it.cat || '', claimed: false,
      dormant: true, createdBy: '待发起', createdAt: now, industry: id, seedSource: 'extra',
      marks: { did: 0, valid: 0, invalid: 0 },
    });
    existing.add(name);
  });
  meta.seededExtra = true;
  saveMeta(meta);
  return g;
}

// ---- 裂变半径：从某节点出发可达的后代节点数（含未展开层，限本行业）----
function radiusOf(g, id) {
  const adj = {};
  for (const e of g.edges) (adj[e.source] = adj[e.source] || []).push(e.target);
  const seen = new Set(); const q = [id];
  while (q.length) {
    const cur = q.shift();
    for (const nx of adj[cur] || []) if (!seen.has(nx)) { seen.add(nx); q.push(nx); }
  }
  return seen.size;
}

// ---- 广场层：行业原点 + 热度统计（含搜索/认领状态）----
function industryStats(g, q, all) {
  // all=true 时返回全部（含 dormant），用于星云渲染
  // 搜索时也包含 dormant，默认只返回非 dormant 的正式行业
  let origins = g.nodes.filter(n => n.type === 'origin' && (all || q ? true : !n.dormant));
  if (q) {
    const kw = String(q).trim().toLowerCase();
    if (kw) origins = origins.filter(o =>
      (o.name || '').toLowerCase().includes(kw) || (o.cat || '').toLowerCase().includes(kw));
  }
  const list = origins.map(o => {
    const ns = g.nodes.filter(n => n.industry === o.id && n.visible);
    const marks = ns.reduce((s, n) => s + (n.marks ? n.marks.did + n.marks.valid + n.marks.invalid : 0), 0);
    const last = ns.map(n => n.createdAt || '').sort().pop() || o.createdAt;
    return {
      id: o.id, name: o.name, note: o.note || '', createdBy: o.createdBy || '未知', createdAt: o.createdAt,
      cat: o.cat || '', claimed: !!o.claimed, dormant: !!o.dormant,
      nodeCount: ns.length, contributed: ns.filter(n => n.contributed).length,
      marks, radius: radiusOf(g, o.id), lastActivity: last,
    };
  });
  // 排序：已认领（活跃）优先 → 节点数降序 → 名称
  list.sort((a, b) => (b.claimed ? 1 : 0) - (a.claimed ? 1 : 0) || b.nodeCount - a.nodeCount || String(a.name).localeCompare(String(b.name), 'zh'));
  return list;
}

// ---- 行业层：可见子图（含搜索高亮标记）----
function visibleGraph(g, industryId) {
  let vNodes = g.nodes.filter(n => n.visible);
  if (industryId) vNodes = vNodes.filter(n => n.industry === industryId);
  const ids = new Set(vNodes.map(n => n.id));
  const vEdges = g.edges.filter(e => e.visible && ids.has(e.source) && ids.has(e.target));
  const hiddenChild = new Set(g.edges.filter(e => !e.visible).map(e => e.source));
  return {
    nodes: vNodes.map(n => ({ ...n, radius: radiusOf(g, n.id), hasMore: hiddenChild.has(n.id) })),
    edges: vEdges,
    stats: {
      total: vNodes.length,
      contributed: vNodes.filter(n => n.contributed).length,
      marks: vNodes.reduce((s, n) => s + (n.marks ? n.marks.did + n.marks.valid + n.marks.invalid : 0), 0),
    },
  };
}

const VALID_TYPES = new Set(Object.values(seed.TYPES));
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 65536) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function send(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(buf);
}
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host);
  try {
    // 广场层
    if (req.method === 'GET' && url.pathname === '/api/industries') {
      const q = url.searchParams.get('q');
      const all = url.searchParams.get('all') === 'true';
      return send(res, 200, { industries: industryStats(loadGraph(), q, all) });
    }

    if (req.method === 'POST' && url.pathname === '/api/industries') {
      const b = await readBody(req);
      const name = clip(b.name, 20);
      const firstTouch = clip(b.firstTouch, 30);
      const note = clip(b.note, 300);
      const author = clip(b.author, 20) || '匿名';
      if (!name || !firstTouch) return send(res, 400, { error: '行业名称和第一条变现路径（首触手）都必填' });
      const g = loadGraph();
      if (g.nodes.some(n => n.type === 'origin' && n.name === name)) return send(res, 409, { error: '已存在同名行业' });
      if (g.nodes.some(n => n.name === firstTouch)) return send(res, 409, { error: '首触手与已有节点重名，建议换个更具体的说法' });
      const ts = Date.now().toString(36);
      const oid = 'i' + ts, tid = 'u' + ts + 'a';
      const now = new Date().toISOString();
      g.nodes.push({ id: oid, name, type: 'origin', visible: true, claimed: true, note, createdBy: author, createdAt: now, industry: oid, marks: { did: 0, valid: 0, invalid: 0 } });
      g.nodes.push({ id: tid, name: firstTouch, type: 'monetize', visible: true, contributed: true, pending: true, note: '发起者带来的第一条触手', createdBy: author, createdAt: now, industry: oid, marks: { did: 0, valid: 0, invalid: 0 } });
      g.edges.push({ id: 'ue' + ts, source: oid, target: tid, op: '能力→变现', visible: true, contributed: true, industry: oid, marks: { did: 0, valid: 0, invalid: 0 } });
      saveGraph(g);
      return send(res, 201, { industries: industryStats(g), created: oid });
    }

    // 认领一个待认领行业（认领即激活：必须补首触手）
    if (req.method === 'POST' && url.pathname === '/api/industries/claim') {
      const b = await readBody(req);
      const id = clip(b.id, 40);
      const firstTouch = clip(b.firstTouch, 30);
      const note = clip(b.note, 300);
      const author = clip(b.author, 20) || '匿名';
      if (!firstTouch) return send(res, 400, { error: '认领时必须填写第一条变现路径（首触手）' });
      const g = loadGraph();
      const o = g.nodes.find(n => n.id === id && n.type === 'origin');
      if (!o) return send(res, 404, { error: '行业不存在' });
      if (o.claimed) return send(res, 409, { error: '该行业已被认领' });
      if (g.nodes.some(n => n.name === firstTouch)) return send(res, 409, { error: '首触手与已有节点重名，建议换个更具体的说法' });
      const ts = Date.now().toString(36);
      const tid = 'u' + ts + 'a';
      const now = new Date().toISOString();
      o.claimed = true; o.dormant = false; o.createdBy = author; o.createdAt = now;
      if (note) o.note = note;
      g.nodes.push({ id: tid, name: firstTouch, type: 'monetize', visible: true, contributed: true, pending: true, note: '发起者带来的第一条触手', createdBy: author, createdAt: now, industry: o.id, marks: { did: 0, valid: 0, invalid: 0 } });
      g.edges.push({ id: 'ue' + ts, source: o.id, target: tid, op: '能力→变现', visible: true, contributed: true, industry: o.id, marks: { did: 0, valid: 0, invalid: 0 } });
      saveGraph(g);
      return send(res, 201, { id: o.id, industries: industryStats(g) });
    }

    // 行业层
    if (req.method === 'GET' && url.pathname === '/api/graph') {
      const ind = clip(url.searchParams.get('industry'), 40) || null;
      const g = loadGraph();
      const vg = visibleGraph(g, ind);
      const q = url.searchParams.get('q');
      if (q) {
        const kw = String(q).trim().toLowerCase();
        vg.nodes.forEach(n => {
          n.qMatch = (n.name || '').toLowerCase().includes(kw)
            || (n.note || '').toLowerCase().includes(kw)
            || (n.type || '').toLowerCase().includes(kw);
        });
        vg.stats.matchCount = vg.nodes.filter(n => n.qMatch).length;
      } else {
        vg.nodes.forEach(n => { n.qMatch = true; });
        vg.stats.matchCount = vg.nodes.length;
      }
      return send(res, 200, vg);
    }

    if (req.method === 'POST' && url.pathname === '/api/expand') {
      const { id } = await readBody(req);
      const g = loadGraph();
      const node = g.nodes.find(n => n.id === id);
      if (!node) return send(res, 404, { error: '节点不存在' });
      const revealEdges = g.edges.filter(e => !e.visible && e.source === id);
      const childIds = new Set(revealEdges.map(e => e.target));
      for (const e of revealEdges) e.visible = true;
      for (const n of g.nodes) if (childIds.has(n.id)) n.visible = true;
      saveGraph(g);
      return send(res, 200, visibleGraph(g, node.industry));
    }

    if (req.method === 'POST' && url.pathname === '/api/nodes') {
      const b = await readBody(req);
      const name = clip(b.name, 30);
      const type = clip(b.type, 20);
      const parentId = clip(b.parentId, 40);
      const note = clip(b.note, 300);
      const author = clip(b.author, 20) || '匿名';
      const op = clip(b.op, 20) || '补充';
      if (!name) return send(res, 400, { error: '节点名称必填' });
      if (!VALID_TYPES.has(type)) return send(res, 400, { error: '节点类型非法' });
      const g = loadGraph();
      const parent = g.nodes.find(n => n.id === parentId && n.visible);
      if (!parent) return send(res, 400, { error: '必须挂到一个已有节点上（挂边优先）' });
      if (g.nodes.some(n => n.name === name)) return send(res, 409, { error: '已存在同名节点，建议去补充验证标记' });
      const nid = 'u' + Date.now().toString(36);
      g.nodes.push({ id: nid, name, type, visible: true, contributed: true, pending: true, note, createdBy: author, createdAt: new Date().toISOString(), industry: parent.industry, marks: { did: 0, valid: 0, invalid: 0 } });
      g.edges.push({ id: 'ue' + Date.now().toString(36), source: parentId, target: nid, op, visible: true, contributed: true, industry: parent.industry, marks: { did: 0, valid: 0, invalid: 0 } });
      saveGraph(g);
      return send(res, 201, visibleGraph(g, parent.industry));
    }

    if (req.method === 'POST' && url.pathname === '/api/marks') {
      const b = await readBody(req);
      const kind = clip(b.kind, 10);
      if (!['did', 'valid', 'invalid'].includes(kind)) return send(res, 400, { error: '标记类型非法' });
      const g = loadGraph();
      const node = g.nodes.find(n => n.id === clip(b.nodeId, 40) && n.visible);
      if (!node) return send(res, 404, { error: '节点不存在' });
      node.marks = node.marks || { did: 0, valid: 0, invalid: 0 };
      node.marks[kind] += 1;
      saveGraph(g);
      return send(res, 200, visibleGraph(g, node.industry));
    }

    // ─── 本地经验模块 ───

    // 列表/搜索
    if (req.method === 'GET' && url.pathname === '/api/experiences') {
      const city = clip(url.searchParams.get('city'), 20) || '';
      const category = clip(url.searchParams.get('category'), 20) || '';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      let list = loadExperiences();
      if (city) list = list.filter(e => e.city === city);
      if (category) list = list.filter(e => e.category === category);
      if (q) {
        const kw = q;
        list = list.filter(e =>
          (e.title || '').toLowerCase().includes(kw) ||
          (e.tags || []).some(t => t.toLowerCase().includes(kw)) ||
          (e.steps || []).some(s =>
            (s.title || '').toLowerCase().includes(kw) ||
            (s.content || '').toLowerCase().includes(kw)
          )
        );
      }
      // 最新在前
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return send(res, 200, { experiences: list });
    }

    // 详情
    if (req.method === 'GET' && url.pathname.startsWith('/api/experiences/')) {
      const id = url.pathname.slice('/api/experiences/'.length);
      const list = loadExperiences();
      const exp = list.find(e => e.id === id);
      if (!exp) return send(res, 404, { error: '经验不存在' });
      return send(res, 200, exp);
    }

    // 发布
    if (req.method === 'POST' && url.pathname === '/api/experiences') {
      const b = await readBody(req);
      const title = clip(b.title, 60);
      const city = clip(b.city, 20);
      const category = clip(b.category, 20);
      const author = clip(b.author, 20) || '匿名';
      const steps = Array.isArray(b.steps) ? b.steps.slice(0, 20) : [];
      const tags = Array.isArray(b.tags) ? b.tags.map(t => clip(t, 15)).filter(Boolean).slice(0, 10) : [];
      if (!title || !city || !category) return send(res, 400, { error: '标题、城市、分类为必填项' });
      if (!EXP_CATEGORIES.has(category)) return send(res, 400, { error: '分类不在可选范围内' });
      // 过滤非法步骤（null/非对象/标题为空）
      const validSteps = steps.filter(s => s && typeof s === 'object' && typeof s.title === 'string' && s.title.trim());
      if (validSteps.length === 0) return send(res, 400, { error: '至少填写一个有效步骤（每个步骤必须有标题）' });
      if (validSteps.length < steps.length) {
        steps.length = 0; steps.push(...validSteps);
      }
      const cleanSteps = steps.map(s => ({
        title: clip(s.title, 60),
        content: clip(s.content, 2000),
        duration: clip(s.duration, 30) || '未知',
        cost: clip(s.cost, 30) || '未知',
        pitfalls: Array.isArray(s.pitfalls) ? s.pitfalls.slice(0, 10).map(p => ({
          text: clip(typeof p === 'string' ? p : p.text, 500),
          author: clip(typeof p === 'string' ? '原文' : p.author, 20) || '原文',
          addedAt: new Date().toISOString()
        })) : [],
        solutions: Array.isArray(s.solutions) ? s.solutions.slice(0, 10).map(sol => ({
          text: clip(typeof sol === 'string' ? sol : sol.text, 500),
          author: clip(typeof sol === 'string' ? '原文' : sol.author, 20) || '原文',
          addedAt: new Date().toISOString()
        })) : []
      }));
      const totalDuration = clip(b.totalDuration, 30) || '未知';
      const totalCost = clip(b.totalCost, 30) || '未知';
      const now = new Date().toISOString();
      const exp = {
        id: 'ex_' + Date.now().toString(36),
        title, city, category, author,
        createdAt: now, updatedAt: now,
        totalDuration, totalCost,
        steps: cleanSteps,
        supplements: [],
        tags
      };
      const list = loadExperiences();
      list.push(exp);
      saveExperiences(list);
      return send(res, 201, exp);
    }

    // 补充
    if (req.method === 'POST' && url.pathname.startsWith('/api/experiences/') && url.pathname.endsWith('/supplement')) {
      const id = url.pathname.slice('/api/experiences/'.length, -'/supplement'.length);
      const b = await readBody(req);
      const stepIndex = b.stepIndex != null ? parseInt(b.stepIndex, 10) : null;
      const type = clip(b.type, 10);
      const content = clip(b.content, 1000);
      const author = clip(b.author, 20) || '匿名';
      if (!content) return send(res, 400, { error: '补充内容不能为空' });
      if (!['update', 'pitfall', 'solution', 'general'].includes(type)) return send(res, 400, { error: '补充类型非法，可选：update/pitfall/solution/general' });
      const list = loadExperiences();
      const exp = list.find(e => e.id === id);
      if (!exp) return send(res, 404, { error: '经验不存在' });
      const supp = {
        stepIndex,
        type,
        content,
        author,
        createdAt: new Date().toISOString()
      };
      exp.supplements.push(supp);

      // 如果是 pitfall/solution 补充且指定了步骤，同时追加到步骤的对应列表
      if (stepIndex != null && exp.steps[stepIndex]) {
        const step = exp.steps[stepIndex];
        if (type === 'pitfall') {
          step.pitfalls = step.pitfalls || [];
          step.pitfalls.push({ text: content, author, addedAt: supp.createdAt });
        } else if (type === 'solution') {
          step.solutions = step.solutions || [];
          step.solutions.push({ text: content, author, addedAt: supp.createdAt });
        }
      }

      exp.updatedAt = new Date().toISOString();
      saveExperiences(list);
      return send(res, 201, exp);
    }

    // 静态资源
    if (req.method === 'GET') {
      let fp = url.pathname === '/' ? '/index.html' : url.pathname;
      const abs = path.normalize(path.join(STATIC_DIR, fp));
      if (!abs.startsWith(STATIC_DIR)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(abs)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        return fs.createReadStream(abs).pipe(res);
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    send(res, 500, { error: 'server error: ' + e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`商机嗅探器 MVP 已启动: http://${HOST}:${PORT}（版本见 VERSION 文件）`);
  console.log(`数据文件: ${DATA_FILE}`);
});
