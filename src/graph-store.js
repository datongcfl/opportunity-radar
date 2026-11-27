const fs = require('fs');
const path = require('path');
const defaultSeed = require('./seed.js');
const { clip, uid, readBody, send } = require('./http-utils');

/**
 * Propagate industry ownership from origin nodes along directed edges via BFS.
 * Mutates `g.nodes` and `g.edges` in place for legacy data backfill.
 * @param {{ nodes: any[], edges: any[] }} g
 */
function stampIndustry(g) {
  const adj = {};
  for (const e of g.edges) (adj[e.source] = adj[e.source] || []).push(e.target);
  const origins = g.nodes.filter(n => n.type === 'origin');
  const owner = {};
  for (const o of origins) {
    if (owner[o.id]) continue;
    const q = [o.id];
    owner[o.id] = o.id;
    while (q.length) {
      const cur = q.shift();
      for (const nx of adj[cur] || []) {
        if (!owner[nx]) {
          owner[nx] = o.id;
          q.push(nx);
        }
      }
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

/**
 * Count all reachable descendant nodes from `id` across both visible and hidden edges.
 * @param {{ edges: any[] }} g
 * @param {string} id
 * @returns {number}
 */
function radiusOf(g, id) {
  const adj = {};
  for (const e of g.edges) (adj[e.source] = adj[e.source] || []).push(e.target);
  const seen = new Set();
  const q = [id];
  while (q.length) {
    const cur = q.shift();
    for (const nx of adj[cur] || []) {
      if (!seen.has(nx)) {
        seen.add(nx);
        q.push(nx);
      }
    }
  }
  return seen.size;
}

/**
 * Build plaza-level summary stats for industries, optionally filtered by query or dormant visibility.
 * @param {{ nodes: any[], edges: any[] }} g
 * @param {string|null} q
 * @param {boolean} all
 */
function industryStats(g, q, all) {
  let origins = g.nodes.filter(n => n.type === 'origin' && (all || q ? true : !n.dormant));
  if (q) {
    const kw = String(q).trim().toLowerCase();
    if (kw) {
      origins = origins.filter(o =>
        (o.name || '').toLowerCase().includes(kw) || (o.cat || '').toLowerCase().includes(kw)
      );
    }
  }
  const list = origins.map(o => {
    const ns = g.nodes.filter(n => n.industry === o.id && n.visible);
    const marks = ns.reduce(
      (s, n) => s + (n.marks ? n.marks.did + n.marks.valid + n.marks.invalid : 0),
      0
    );
    const last = ns.map(n => n.createdAt || '').sort().pop() || o.createdAt;
    return {
      id: o.id,
      name: o.name,
      note: o.note || '',
      createdBy: o.createdBy || '未知',
      createdAt: o.createdAt,
      cat: o.cat || '',
      claimed: !!o.claimed,
      dormant: !!o.dormant,
      nodeCount: ns.length,
      contributed: ns.filter(n => n.contributed).length,
      marks,
      radius: radiusOf(g, o.id),
      lastActivity: last,
    };
  });
  list.sort((a, b) =>
    (b.claimed ? 1 : 0) - (a.claimed ? 1 : 0)
    || b.nodeCount - a.nodeCount
    || String(a.name).localeCompare(String(b.name), 'zh')
  );
  return list;
}

/**
 * Extract the visible subgraph (optionally scoped to one industry), computing `radius` and `hasMore`.
 * @param {{ nodes: any[], edges: any[] }} g
 * @param {string|null} industryId
 */
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

/**
 * Create an isolated graph store and HTTP route handler backed by `dataDir`.
 * @param {{ dataDir: string, seed?: typeof defaultSeed }} options
 */
function createGraphStore({ dataDir, seed = defaultSeed }) {
  const DATA_FILE = path.join(dataDir, 'graph.json');
  const SEED360_FILE = path.join(dataDir, 'industries-360.json');
  const EXTRA_FILE = path.join(dataDir, 'industries-extra.json');
  const META_FILE = path.join(dataDir, 'meta.json');
  const VALID_TYPES = new Set(Object.values(seed.TYPES));

  function loadMeta() {
    try {
      return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    } catch (_) {
      return { seeded360: false, seededExtra: false };
    }
  }

  function saveMeta(meta) {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
    } catch (_) {}
  }

  function saveGraph(g) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(g, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  }

  function seedOriginsFromFile(g, filePath, metaKey, opts) {
    const meta = loadMeta();
    if (meta[metaKey]) return g;
    if (!fs.existsSync(filePath)) {
      if (opts.markMissingDone) meta[metaKey] = true;
      saveMeta(meta);
      return g;
    }
    let list = [];
    try {
      list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
      if (opts.markMissingDone) meta[metaKey] = true;
      saveMeta(meta);
      return g;
    }
    if (!Array.isArray(list) || list.length === 0) {
      if (opts.markMissingDone) meta[metaKey] = true;
      saveMeta(meta);
      return g;
    }
    const now = new Date().toISOString();
    const existing = new Set(g.nodes.map(n => n.name));
    list.forEach((it, i) => {
      const name = String((it && it.name) || '').trim();
      if (!name || existing.has(name)) return;
      const id = opts.idPrefix + String(i).padStart(3, '0');
      const node = {
        id,
        name,
        type: 'origin',
        visible: true,
        cat: (it && it.cat) || '',
        claimed: false,
        createdBy: opts.createdBy,
        createdAt: now,
        industry: id,
        seedSource: opts.seedSource,
        marks: { did: 0, valid: 0, invalid: 0 },
      };
      if (opts.dormant) node.dormant = true;
      g.nodes.push(node);
      existing.add(name);
    });
    meta[metaKey] = true;
    saveMeta(meta);
    return g;
  }

  function loadGraph() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      const g = {
        nodes: seed.nodes.map(n => ({
          ...n,
          marks: { did: 0, valid: 0, invalid: 0 },
          createdAt: '2026-07-19T21:00:00+08:00',
        })),
        edges: seed.edges.map((e, i) => ({
          id: 'se' + i,
          ...e,
          marks: { did: 0, valid: 0, invalid: 0 },
        })),
      };
      saveGraph(stampIndustry(g));
    }
    let g = stampIndustry(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    const before = g.nodes.length;
    g = seedOriginsFromFile(g, SEED360_FILE, 'seeded360', {
      idPrefix: 'i36_',
      createdBy: '待认领',
      seedSource: '360',
      dormant: false,
      markMissingDone: false,
    });
    if (g.nodes.length !== before) {
      g = stampIndustry(g);
      saveGraph(g);
    }
    const before2 = g.nodes.length;
    g = seedOriginsFromFile(g, EXTRA_FILE, 'seededExtra', {
      idPrefix: 'ix_',
      createdBy: '待发起',
      seedSource: 'extra',
      dormant: true,
      markMissingDone: true,
    });
    if (g.nodes.length !== before2) {
      g = stampIndustry(g);
      saveGraph(g);
    }
    return g;
  }

  /**
   * Handle plaza and industry-graph endpoints; return true if handled.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {URL} url
   */
  async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/industries') {
      const q = url.searchParams.get('q');
      const all = url.searchParams.get('all') === 'true';
      send(res, 200, { industries: industryStats(loadGraph(), q, all) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/industries') {
      const b = await readBody(req);
      const name = clip(b.name, 20);
      const firstTouch = clip(b.firstTouch, 30);
      const note = clip(b.note, 300);
      const author = clip(b.author, 20) || '匿名';
      if (!name || !firstTouch) {
        send(res, 400, { error: '行业名称和第一条变现路径（首触手）都必填' });
        return true;
      }
      const g = loadGraph();
      if (g.nodes.some(n => n.type === 'origin' && n.name === name)) {
        send(res, 409, { error: '已存在同名行业' });
        return true;
      }
      if (g.nodes.some(n => n.name === firstTouch)) {
        send(res, 409, { error: '首触手与已有节点重名，建议换个更具体的说法' });
        return true;
      }
      const oid = uid('i');
      const tid = uid('u');
      const now = new Date().toISOString();
      g.nodes.push({
        id: oid, name, type: 'origin', visible: true, claimed: true, note,
        createdBy: author, createdAt: now, industry: oid,
        marks: { did: 0, valid: 0, invalid: 0 },
      });
      g.nodes.push({
        id: tid, name: firstTouch, type: 'monetize', visible: true,
        contributed: true, pending: true, note: '发起者带来的第一条触手',
        createdBy: author, createdAt: now, industry: oid,
        marks: { did: 0, valid: 0, invalid: 0 },
      });
      g.edges.push({
        id: uid('ue'), source: oid, target: tid, op: '能力→变现',
        visible: true, contributed: true, industry: oid,
        marks: { did: 0, valid: 0, invalid: 0 },
      });
      saveGraph(g);
      send(res, 201, { industries: industryStats(g, null, true), created: oid });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/industries/claim') {
      const b = await readBody(req);
      const id = clip(b.id, 40);
      const firstTouch = clip(b.firstTouch, 30);
      const note = clip(b.note, 300);
      const author = clip(b.author, 20) || '匿名';
      if (!id) {
        send(res, 400, { error: '行业 id 必填' });
        return true;
      }
      if (!firstTouch) {
        send(res, 400, { error: '认领时必须填写第一条变现路径（首触手）' });
        return true;
      }
      const g = loadGraph();
      const o = g.nodes.find(n => n.id === id && n.type === 'origin');
      if (!o) {
        send(res, 404, { error: '行业不存在' });
        return true;
      }
      if (o.claimed) {
        send(res, 409, { error: '该行业已被认领' });
        return true;
      }
      if (g.nodes.some(n => n.name === firstTouch)) {
        send(res, 409, { error: '首触手与已有节点重名，建议换个更具体的说法' });
        return true;
      }
      const tid = uid('u');
      const now = new Date().toISOString();
      o.claimed = true;
      o.dormant = false;
      o.createdBy = author;
      o.createdAt = now;
      if (note) o.note = note;
      g.nodes.push({
        id: tid, name: firstTouch, type: 'monetize', visible: true,
        contributed: true, pending: true, note: '发起者带来的第一条触手',
        createdBy: author, createdAt: now, industry: o.id,
        marks: { did: 0, valid: 0, invalid: 0 },
      });
      g.edges.push({
        id: uid('ue'), source: o.id, target: tid, op: '能力→变现',
        visible: true, contributed: true, industry: o.id,
        marks: { did: 0, valid: 0, invalid: 0 },
      });
      saveGraph(g);
      send(res, 201, { id: o.id, industries: industryStats(g, null, true) });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/graph') {
      const ind = clip(url.searchParams.get('industry'), 40) || null;
      const g = loadGraph();
      const vg = visibleGraph(g, ind);
      const q = url.searchParams.get('q');
      if (q && String(q).trim()) {
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
      send(res, 200, vg);
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/expand') {
      const b = await readBody(req);
      const id = clip(b.id, 40);
      if (!id) {
        send(res, 400, { error: '节点 id 必填' });
        return true;
      }
      const g = loadGraph();
      const node = g.nodes.find(n => n.id === id);
      if (!node) {
        send(res, 404, { error: '节点不存在' });
        return true;
      }
      const revealEdges = g.edges.filter(e => !e.visible && e.source === id);
      const childIds = new Set(revealEdges.map(e => e.target));
      for (const e of revealEdges) e.visible = true;
      for (const n of g.nodes) if (childIds.has(n.id)) n.visible = true;
      saveGraph(g);
      send(res, 200, visibleGraph(g, node.industry));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/nodes') {
      const b = await readBody(req);
      const name = clip(b.name, 30);
      const type = clip(b.type, 20);
      const parentId = clip(b.parentId, 40);
      const note = clip(b.note, 300);
      const author = clip(b.author, 20) || '匿名';
      const op = clip(b.op, 20) || '补充';
      if (!name) {
        send(res, 400, { error: '节点名称必填' });
        return true;
      }
      if (!VALID_TYPES.has(type) || type === 'origin') {
        send(res, 400, { error: '节点类型非法' });
        return true;
      }
      const g = loadGraph();
      const parent = g.nodes.find(n => n.id === parentId && n.visible);
      if (!parent) {
        send(res, 400, { error: '必须挂到一个已有节点上（挂边优先）' });
        return true;
      }
      if (g.nodes.some(n => n.name === name)) {
        send(res, 409, { error: '已存在同名节点，建议去补充验证标记' });
        return true;
      }
      const nid = uid('u');
      g.nodes.push({
        id: nid, name, type, visible: true, contributed: true, pending: true,
        note, createdBy: author, createdAt: new Date().toISOString(),
        industry: parent.industry, marks: { did: 0, valid: 0, invalid: 0 },
      });
      g.edges.push({
        id: uid('ue'), source: parentId, target: nid, op, visible: true,
        contributed: true, industry: parent.industry,
        marks: { did: 0, valid: 0, invalid: 0 },
      });
      saveGraph(g);
      send(res, 201, { created: nid, ...visibleGraph(g, parent.industry) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/marks') {
      const b = await readBody(req);
      const kind = clip(b.kind, 10);
      if (!['did', 'valid', 'invalid'].includes(kind)) {
        send(res, 400, { error: '标记类型非法' });
        return true;
      }
      const nodeId = clip(b.nodeId, 40);
      if (!nodeId) {
        send(res, 400, { error: '节点 nodeId 必填' });
        return true;
      }
      const g = loadGraph();
      const node = g.nodes.find(n => n.id === nodeId && n.visible);
      if (!node) {
        send(res, 404, { error: '节点不存在' });
        return true;
      }
      node.marks = node.marks || { did: 0, valid: 0, invalid: 0 };
      node.marks[kind] += 1;
      saveGraph(g);
      send(res, 200, visibleGraph(g, node.industry));
      return true;
    }

    return false;
  }

  return {
    loadGraph,
    saveGraph,
    handle,
  };
}

module.exports = {
  createGraphStore,
  stampIndustry,
  radiusOf,
  industryStats,
  visibleGraph,
};
