const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { clip, readBody, send } = require('./http-utils');

/**
 * Validate node ID uniqueness, endpoint existence, and DAG acyclicity for desk graphs.
 * @param {Array<{id: string}>} nodes
 * @param {Array<{source: string, target: string}>} edges
 * @param {Array<{source: string, target: string}>} bridges
 * @returns {string | null} Error message if invalid, otherwise null.
 */
function validateDeskGraph(nodes, edges, bridges) {
  const nodeIds = new Set();
  for (const n of nodes) {
    if (nodeIds.has(n.id)) return `桌面节点 ID 重复: ${n.id}`;
    nodeIds.add(n.id);
  }

  const adj = new Map();
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      return `桌面连线引用了不存在的节点: ${e.source} -> ${e.target}`;
    }
    if (e.source === e.target) {
      return `桌面连线不允许自环: ${e.source}`;
    }
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }

  // 3-color DFS cycle detection (0=unvisited, 1=visiting, 2=done)
  const state = new Map();
  function hasCycle(u) {
    state.set(u, 1);
    for (const v of adj.get(u) || []) {
      const st = state.get(v) || 0;
      if (st === 1) return true;
      if (st === 0 && hasCycle(v)) return true;
    }
    state.set(u, 2);
    return false;
  }
  for (const id of nodeIds) {
    if ((state.get(id) || 0) === 0 && hasCycle(id)) {
      return '桌面连线存在环状结构，已拒绝保存以防渲染死循环';
    }
  }

  for (const br of bridges) {
    if (!nodeIds.has(br.source) || !nodeIds.has(br.target)) {
      return `跨界桥引用了不存在的节点: ${br.source} -> ${br.target}`;
    }
    if (br.source === br.target) {
      return `跨界桥不允许指向自身: ${br.source}`;
    }
  }
  return null;
}

/**
 * Persist and serve the Spatial Opportunity Desk workspace (`desk.json`) isolated per `dataDir`.
 * @param {{ dataDir: string }} options
 */
function createDeskStore({ dataDir }) {
  const DESK_FILE = path.join(dataDir, 'desk.json');

  function loadDesk() {
    if (!fs.existsSync(DESK_FILE)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(DESK_FILE, 'utf8'));
      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        return parsed;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function saveDesk(doc) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${DESK_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
      fs.renameSync(tmp, DESK_FILE);
    } finally {
      if (fs.existsSync(tmp)) {
        try { fs.unlinkSync(tmp); } catch (_) {}
      }
    }
  }

  async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/desk') {
      send(res, 200, { doc: loadDesk() });
      return true;
    }

    if (req.method === 'PUT' && url.pathname === '/api/desk') {
      const b = await readBody(req, 262144);
      if (!Array.isArray(b.nodes) || !Array.isArray(b.edges)) {
        send(res, 400, { error: '桌面数据结构非法：缺少 nodes 或 edges 数组' });
        return true;
      }
      if (b.nodes.length > 500 || b.edges.length > 1000) {
        send(res, 400, { error: '桌面节点或连线数量超出上限' });
        return true;
      }
      const cleanDoc = {
        theme: clip(b.theme || 'stone-dark', 24) || 'stone-dark',
        updatedAt: new Date().toISOString(),
        nodes: b.nodes.map(n => ({
          id: clip(n && n.id, 48),
          type: clip(n && n.type, 20) || 'monetize',
          cat: clip(n && n.cat, 24),
          title: clip(n && n.title, 60),
          summary: clip(n && n.summary, 500),
          earn: clip(n && n.earn, 40),
          barrier: clip(n && n.barrier, 40),
          firstStep: clip(n && n.firstStep, 200),
          risk: clip(n && n.risk, 240),
          killReason: clip(n && n.killReason, 240),
          status: ['exploring', 'starred', 'falsified'].includes(n && n.status) ? n.status : 'exploring',
          evidence: Array.isArray(n && n.evidence) ? n.evidence.slice(0, 6).map(Boolean) : [false, false, false, false, false, false],
          radarPack: clip(n && n.radarPack, 40) || '',
          did: Math.max(0, parseInt(n && n.did, 10) || 0),
          valid: Math.max(0, parseInt(n && n.valid, 10) || 0),
          onDesk: !(n && n.onDesk === false),
          collapsed: !!(n && n.collapsed),
          x: Math.round(Number(n && n.x) || 0),
          y: Math.round(Number(n && n.y) || 0),
        })).filter(n => n.id && n.title),
        edges: b.edges.slice(0, 1000).map(e => ({
          id: clip(e && e.id, 48) || ('e_' + Math.random().toString(36).slice(2, 8)),
          source: clip(e && e.source, 48),
          target: clip(e && e.target, 48),
          op: clip(e && e.op, 24) || '衍生',
        })).filter(e => e.source && e.target),
        bridges: (Array.isArray(b.bridges) ? b.bridges : []).slice(0, 300).map(br => ({
          id: clip(br && br.id, 48) || ('b_' + Math.random().toString(36).slice(2, 8)),
          source: clip(br && br.source, 48),
          target: clip(br && br.target, 48),
          label: clip(br && br.label, 80) || '跨界相通点',
        })).filter(br => br.source && br.target),
      };
      const graphErr = validateDeskGraph(cleanDoc.nodes, cleanDoc.edges, cleanDoc.bridges);
      if (graphErr) {
        send(res, 400, { error: graphErr });
        return true;
      }
      saveDesk(cleanDoc);
      send(res, 200, { ok: true, updatedAt: cleanDoc.updatedAt });
      return true;
    }

    return false;
  }

  return { loadDesk, saveDesk, handle };
}

module.exports = { createDeskStore };
