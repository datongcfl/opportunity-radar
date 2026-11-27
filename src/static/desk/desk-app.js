import { DeskStore, EVIDENCE_DIMS, ROLE_META, FISSION_PRESETS } from './state.js';
import { computeVisibleSet, tidyDeskLayout, computeSnap } from './layout.js';

const store = new DeskStore();

// Ensure clean initial non-overlapping coordinates on first load
if (!localStorage.getItem('opp_radar_spatial_desk_v6')) {
  tidyDeskLayout(store.doc);
  store.saveQuiet();
}

const ui = {
  panX: 30,
  panY: -10,
  zoom: 0.84,
  flyTarget: null, // { panX, panY, zoom }
  selectedIds: new Set(),
  hoveredId: null,
  editingId: null,
  composer: null, // { parentId, presetIdx, x, y }
  onlyStarred: false,
  snapGuides: { x: null, y: null },
  bridgeDraft: null, // { sourceId, x1, y1, x2, y2 }
  industryPool: [],
  radarPacks: [],
  radarModal: { nodeId: null, pack: '', tab: 'matrix', detail: null, loading: false },
};

const $ = (id) => document.getElementById(id);
const desk = $('desk');
const world = $('world');
const edgesSvg = $('edgesSvg');
const edgePills = $('edgePills');
const cardsLayer = $('cardsLayer');
const minimapCanvas = $('minimapCanvas');
const marqueeBox = $('marqueeBox');

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function screenToWorld(clientX, clientY) {
  return {
    x: (clientX - window.innerWidth / 2 - ui.panX) / ui.zoom,
    y: (clientY - window.innerHeight / 2 - ui.panY) / ui.zoom,
  };
}

function applyTheme(slug, persist = true) {
  store.doc.theme = slug;
  document.documentElement.dataset.theme = slug;
  $('themeSelect').value = slug;
  if (persist) store.saveQuiet();
  drawMinimap();
}

function applyTransform() {
  world.style.transform = `translate3d(${ui.panX}px, ${ui.panY}px, 0) scale(${ui.zoom})`;
  world.dataset.lod = ui.zoom < 0.62 ? 'macro' : 'detail';
  $('zoomReadout').textContent = Math.round(ui.zoom * 100) + '%';
  drawMinimap();
}

function flyToWorld(wx, wy, targetZoom = Math.max(ui.zoom, 0.86)) {
  ui.flyTarget = {
    panX: -wx * targetZoom,
    panY: -wy * targetZoom,
    zoom: targetZoom,
  };
}

function tickCamera() {
  if (ui.flyTarget) {
    ui.panX += (ui.flyTarget.panX - ui.panX) * 0.2;
    ui.panY += (ui.flyTarget.panY - ui.panY) * 0.2;
    ui.zoom += (ui.flyTarget.zoom - ui.zoom) * 0.2;
    applyTransform();
    if (
      Math.abs(ui.flyTarget.panX - ui.panX) < 0.6
      && Math.abs(ui.flyTarget.panY - ui.panY) < 0.6
      && Math.abs(ui.flyTarget.zoom - ui.zoom) < 0.005
    ) {
      ui.panX = ui.flyTarget.panX;
      ui.panY = ui.flyTarget.panY;
      ui.zoom = ui.flyTarget.zoom;
      ui.flyTarget = null;
      applyTransform();
    }
  }
  requestAnimationFrame(tickCamera);
}

// ---- Render Top Origin Bookmarks ----
function renderOriginTabs() {
  const activeOrigins = store.doc.nodes.filter(n => n.type === 'origin' && n.onDesk !== false);
  const archivedCount = store.doc.nodes.filter(n => n.type === 'origin' && n.onDesk === false).length;
  $('cabinetBadge').textContent = archivedCount ? `归档 ${archivedCount} · 词库 ${ui.industryPool.length || 771}` : `词库 ${ui.industryPool.length || 771}`;

  const wrap = $('originTabs');
  wrap.innerHTML = activeOrigins.map(o => `
    <button class="origin-tab ${ui.selectedIds.has(o.id) ? 'active' : ''}" data-fly="${esc(o.id)}">
      ${esc(o.title)}
    </button>
  `).join('');

  wrap.querySelectorAll('[data-fly]').forEach(btn => {
    btn.onclick = () => {
      const target = store.doc.nodes.find(n => n.id === btn.dataset.fly);
      if (target) {
        ui.selectedIds = new Set([target.id]);
        flyToWorld(target.x + 140, target.y, 0.86);
        renderAll();
      }
    };
  });
}

// ---- Render SVG Edges, Bridges & Snap Guides ----
function bezierPath(x1, y1, x2, y2) {
  const dx = Math.max(64, Math.abs(x2 - x1) * 0.46);
  const c1x = x1 + (x2 >= x1 ? dx : -dx);
  const c2x = x2 - (x2 >= x1 ? dx : -dx);
  return `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
}

function renderEdges(visibleIds) {
  const visMap = new Map(
    store.doc.nodes.filter(n => visibleIds.has(n.id)).map(n => [n.id, n])
  );
  const focusId = ui.hoveredId || (ui.selectedIds.size === 1 ? Array.from(ui.selectedIds)[0] : null);
  let svg = '';
  let pills = '';

  for (const e of store.doc.edges) {
    const s = visMap.get(e.source);
    const t = visMap.get(e.target);
    if (!s || !t) continue;

    const sw = s.type === 'origin' ? 146 : (s.status === 'falsified' ? 118 : 134);
    const tw = t.type === 'origin' ? 146 : (t.status === 'falsified' ? 118 : 134);
    const sx = s.x + sw;
    const sy = s.y;
    const tx = t.x - tw;
    const ty = t.y;

    const active = focusId && (e.source === focusId || e.target === focusId);
    const starDim = ui.onlyStarred && t.status !== 'starred' && s.status !== 'starred';
    const dimmed = starDim || (focusId && !active);
    const cls = ['edge-path', active ? 'highlighted' : '', dimmed ? 'dimmed' : ''].filter(Boolean).join(' ');
    svg += `<path class="${cls}" d="${bezierPath(sx, sy, tx, ty)}" />`;

    if (ui.zoom >= 0.58) {
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const pCls = ['edge-pill', active ? 'highlighted' : '', dimmed ? 'dimmed' : ''].filter(Boolean).join(' ');
      pills += `<button class="${pCls}" data-edge-id="${esc(e.id)}" style="left:${mx}px;top:${my}px;" title="点击修改算子名称">${esc(e.op)}</button>`;
    }
  }

  for (const b of store.doc.bridges) {
    const s = visMap.get(b.source);
    const t = visMap.get(b.target);
    if (!s || !t) continue;
    const sameCol = Math.abs(s.x - t.x) < 120;
    let p0x, p0y, c1x, c1y, c2x, c2y, p3x, p3y;
    if (sameCol) {
      p0x = s.x + 134; p0y = s.y + 18;
      p3x = t.x + 134; p3y = t.y - 18;
      const bow = 165;
      c1x = Math.max(p0x, p3x) + bow; c1y = p0y + 30;
      c2x = Math.max(p0x, p3x) + bow; c2y = p3y - 30;
    } else {
      p0x = s.x; p0y = s.y + 58;
      p3x = t.x; p3y = t.y - 58;
      c1x = p0x + 70; c1y = p0y + 120;
      c2x = p3x + 70; c2y = p3y - 120;
    }
    const d = `M ${p0x} ${p0y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p3x} ${p3y}`;
    svg += `<path class="bridge-path" d="${d}" />`;
    if (ui.zoom >= 0.55) {
      const mx = 0.125 * p0x + 0.375 * c1x + 0.375 * c2x + 0.125 * p3x;
      const my = 0.125 * p0y + 0.375 * c1y + 0.375 * c2y + 0.125 * p3y;
      pills += `<button class="edge-pill bridge" data-bridge-id="${esc(b.id)}" style="left:${mx}px;top:${my}px;" title="点击修改或删除跨界相通点">${esc(b.label)}</button>`;
    }
  }

  if (ui.composer) {
    const p = visMap.get(ui.composer.parentId);
    if (p) {
      const sw = p.type === 'origin' ? 146 : 134;
      svg += `<path class="edge-path highlighted pending" d="${bezierPath(p.x + sw, p.y, ui.composer.x - 148, ui.composer.y)}" />`;
    }
  }

  if (ui.bridgeDraft) {
    const { x1, y1, x2, y2 } = ui.bridgeDraft;
    svg += `<path class="bridge-path" d="M ${x1} ${y1} C ${x1} ${y1 + 90}, ${x2} ${y2 - 90}, ${x2} ${y2}" />`;
  }

  if (ui.snapGuides.x !== null) {
    svg += `<line class="snap-line" x1="${ui.snapGuides.x}" y1="-4000" x2="${ui.snapGuides.x}" y2="4000" />`;
  }
  if (ui.snapGuides.y !== null) {
    svg += `<line class="snap-line" x1="-4000" y1="${ui.snapGuides.y}" x2="4000" y2="${ui.snapGuides.y}" />`;
  }

  edgesSvg.innerHTML = svg;
  edgePills.innerHTML = pills;

  edgePills.querySelectorAll('[data-edge-id]').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const edge = store.doc.edges.find(x => x.id === btn.dataset.edgeId);
      if (!edge) return;
      const next = prompt('修改连线算子名称（留空取消）：', edge.op);
      if (next && next.trim()) {
        store.checkpoint();
        edge.op = next.trim().slice(0, 20);
        renderAll();
      }
    };
  });

  edgePills.querySelectorAll('[data-bridge-id]').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const br = store.doc.bridges.find(x => x.id === btn.dataset.bridgeId);
      if (!br) return;
      const next = prompt('修改跨界相通点说明（输入 DEL 可删除该跨界桥）：', br.label);
      if (next === null) return;
      store.checkpoint();
      if (next.trim().toUpperCase() === 'DEL') {
        store.doc.bridges = store.doc.bridges.filter(x => x.id !== br.id);
        toast('已移除跨界相通点');
      } else if (next.trim()) {
        br.label = next.trim().slice(0, 48);
      }
      renderAll();
    };
  });
}

// ---- Render Cards, Inline Editor, and Guided First-Principles Composer ----
function renderCards(visibleIds, childCountMap) {
  cardsLayer.innerHTML = '';
  const visibleNodes = store.doc.nodes.filter(n => visibleIds.has(n.id));

  for (const n of visibleNodes) {
    if (ui.editingId === n.id) {
      cardsLayer.appendChild(buildInlineEditor(n));
      continue;
    }

    const meta = ROLE_META[n.type] || ROLE_META.monetize;
    const descCount = childCountMap.get(n.id) || 0;
    const filledEv = (n.evidence || []).filter(Boolean).length;
    const starDim = ui.onlyStarred && n.status !== 'starred' && n.type !== 'origin';

    const el = document.createElement('article');
    el.className = [
      'fission-card',
      n.type === 'origin' ? 'origin' : '',
      n.status === 'starred' ? 'starred' : '',
      n.status === 'falsified' ? 'falsified' : '',
      ui.selectedIds.has(n.id) ? 'selected' : '',
      starDim ? 'dimmed' : '',
    ].filter(Boolean).join(' ');
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.dataset.id = n.id;

    if (n.status === 'falsified') {
      el.innerHTML = `
        <div class="card-kicker" style="margin-bottom:3px;">
          <span class="kicker-left"><i class="role-dot" style="background:var(--color-danger)"></i><span>已证伪留档</span></span>
          <button class="mini-btn" data-act="restore" title="恢复为探索中">恢复</button>
        </div>
        <h3 class="card-title">${esc(n.title)}</h3>
        <div class="kill-reason">${esc(n.killReason || n.risk || '经测算伪需求或投入产出倒挂')}</div>
      `;
    } else {
      const ticksHtml = EVIDENCE_DIMS.map((dim, i) =>
        `<span class="tick ${n.evidence && n.evidence[i] ? 'on' : ''}" title="${esc(dim)}"></span>`
      ).join('');
      const boundPack = n.radarPack ? ui.radarPacks.find(p => p.pack === n.radarPack) : null;
      const claimsCnt = boundPack && boundPack.claimsSummary ? boundPack.claimsSummary.total : 0;
      const radarBadgeText = boundPack && boundPack.summary
        ? `RADAR · ${boundPack.summary.strong || 0}强/${boundPack.summary.evidence || 0}证 · ${boundPack.sourcesCount}源${claimsCnt ? ` · ${claimsCnt}主张` : ''}`
        : (n.radarPack ? `RADAR · ${n.radarPack}` : (n.type === 'origin' ? '⚡ 生成 radar 探针' : ''));

      el.innerHTML = `
        <div class="card-kicker">
          <span class="kicker-left">
            <i class="role-dot" style="background:${meta.color}"></i>
            <span>${esc(n.cat ? `${meta.label} · ${n.cat}` : meta.label)}</span>
          </span>
          <span>
            ${n.status === 'starred' ? '<span class="status-tag starred">★ 重点深挖</span>' : ''}
            <button class="mini-btn" data-act="star" title="标记/取消重点深挖">${n.status === 'starred' ? '取消重点' : '★ 重点'}</button>
          </span>
        </div>
        <h3 class="card-title">${esc(n.title)}</h3>
        <div class="card-summary">${esc(n.summary || '双击卡片补充商业逻辑、第一步与证据勾选项…')}</div>
        <div class="card-specs">
          ${n.earn ? `<span class="spec-pill">${esc(n.earn)}</span>` : ''}
          ${n.barrier ? `<span class="spec-pill">门槛 · ${esc(n.barrier)}</span>` : ''}
          ${radarBadgeText ? `<button class="radar-pill-trigger" data-act="radar" title="打开 radar 模块覆盖度矩阵与真实来源账本">${esc(radarBadgeText)}</button>` : ''}
        </div>
        <div class="card-footer">
          <div class="evidence-meter" title="双击卡片逐项勾选 6 维证据">
            <span class="ticks">${ticksHtml}</span>
            <span>${filledEv}/6 证据</span>
          </div>
          <div class="card-mini-actions">
            ${n.type === 'origin'
              ? `<button class="mini-btn" data-act="archive" title="收起整棵树回后台归档柜（数据保留）">收起归档</button>`
              : `<button class="mini-btn" data-act="falsify" title="证伪淘汰并保留死因">证伪</button>`}
            <button class="mini-btn" data-act="edit" title="原位编辑全部字段">编辑</button>
          </div>
        </div>
        <div class="card-handles-right">
          <button class="handle-pill accent" data-act="sprout" title="第一性原理提问式原地裂变">+</button>
          ${descCount > 0 ? `
            <button class="handle-pill" data-act="collapse" title="${n.collapsed ? '展开下游分支' : '折叠收起下游分支'}">
              ${n.collapsed ? '+' + descCount : '−' + descCount}
            </button>
          ` : ''}
        </div>
        <div class="bridge-port" data-act="bridge-port" title="按住拖向另一张卡片，建立跨界相通点"></div>
      `;
    }

    bindCardInteractions(el, n, visibleNodes);
    cardsLayer.appendChild(el);
  }

  if (ui.composer) {
    cardsLayer.appendChild(buildGuidedComposer());
  }
}

function bindCardInteractions(el, n, visibleNodes) {
  // Dragging (supports multi-selected group move + magnetic snap guides)
  let startX = 0, startY = 0, moved = false;
  let initialPositions = new Map();

  el.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button') || ev.target.closest('[data-act="bridge-port"]')) return;
    ev.stopPropagation();

    if (ev.shiftKey) {
      if (ui.selectedIds.has(n.id)) ui.selectedIds.delete(n.id);
      else ui.selectedIds.add(n.id);
      renderAll();
      return;
    }
    if (!ui.selectedIds.has(n.id)) {
      ui.selectedIds = new Set([n.id]);
      renderOriginTabs();
      document.querySelectorAll('.fission-card').forEach(c => {
        c.classList.toggle('selected', ui.selectedIds.has(c.dataset.id));
      });
    }

    startX = ev.clientX;
    startY = ev.clientY;
    moved = false;
    initialPositions = new Map();
    for (const id of ui.selectedIds) {
      const item = store.doc.nodes.find(x => x.id === id);
      if (item) initialPositions.set(id, { x: item.x, y: item.y });
    }

    el.setPointerCapture(ev.pointerId);
    const onMove = (me) => {
      const dx = (me.clientX - startX) / ui.zoom;
      const dy = (me.clientY - startY) / ui.zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
        moved = true;
        store.checkpoint();
      }
      if (!moved) return;

      const anchorInit = initialPositions.get(n.id);
      const snap = computeSnap(ui.selectedIds, anchorInit.x + dx, anchorInit.y + dy, visibleNodes);
      const effDx = snap.x - anchorInit.x;
      const effDy = snap.y - anchorInit.y;
      ui.snapGuides = { x: snap.guideX, y: snap.guideY };

      for (const [id, initPos] of initialPositions.entries()) {
        const item = store.doc.nodes.find(x => x.id === id);
        if (item) {
          item.x = Math.round(initPos.x + effDx);
          item.y = Math.round(initPos.y + effDy);
          const domCard = cardsLayer.querySelector(`[data-id="${id}"]`);
          if (domCard) {
            domCard.style.left = item.x + 'px';
            domCard.style.top = item.y + 'px';
          }
        }
      }
      const { visibleIds } = computeVisibleSet(store.doc);
      renderEdges(visibleIds);
      drawMinimap();
    };

    const onUp = (ue) => {
      el.releasePointerCapture(ue.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      if (moved) {
        ui.snapGuides = { x: null, y: null };
        store.saveQuiet();
        renderAll();
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });

  el.addEventListener('dblclick', (ev) => {
    if (ev.target.closest('button')) return;
    ev.stopPropagation();
    ui.editingId = n.id;
    ui.composer = null;
    renderAll();
  });

  el.addEventListener('pointerenter', () => {
    ui.hoveredId = n.id;
    const { visibleIds } = computeVisibleSet(store.doc);
    renderEdges(visibleIds);
  });
  el.addEventListener('pointerleave', () => {
    ui.hoveredId = null;
    const { visibleIds } = computeVisibleSet(store.doc);
    renderEdges(visibleIds);
  });

  // Action buttons
  const onBtn = (sel, fn) => {
    const b = el.querySelector(sel);
    if (b) b.onclick = (ev) => { ev.stopPropagation(); fn(ev); };
  };

  onBtn('[data-act="star"]', () => {
    store.checkpoint();
    n.status = n.status === 'starred' ? 'exploring' : 'starred';
    renderAll();
  });

  onBtn('[data-act="falsify"]', () => {
    const reason = prompt('记录一句证伪原因（留存避坑资产，不会丢失）：', n.killReason || '获客或履约成本倒挂');
    if (reason === null) return;
    store.checkpoint();
    n.status = 'falsified';
    n.killReason = reason.trim() || '经验证走不通';
    tidyDeskLayout(store.doc);
    store.saveQuiet();
    renderAll();
    toast('已证伪折叠留档');
  });

  onBtn('[data-act="restore"]', () => {
    store.checkpoint();
    n.status = 'exploring';
    tidyDeskLayout(store.doc);
    store.saveQuiet();
    renderAll();
  });

  onBtn('[data-act="archive"]', () => {
    store.checkpoint();
    n.onDesk = false;
    ui.selectedIds.delete(n.id);
    tidyDeskLayout(store.doc);
    store.saveQuiet();
    renderAll();
    toast(`已将「${n.title}」收进归档柜，按 ⌘K 可随时恢复上桌`);
  });

  onBtn('[data-act="edit"]', () => {
    ui.editingId = n.id;
    ui.composer = null;
    renderAll();
  });

  onBtn('[data-act="radar"]', () => {
    openRadarModal(n);
  });

  onBtn('[data-act="collapse"]', () => {
    store.checkpoint();
    n.collapsed = !n.collapsed;
    tidyDeskLayout(store.doc);
    store.saveQuiet();
    renderAll();
  });

  onBtn('[data-act="sprout"]', () => {
    if (n.collapsed) n.collapsed = false;
    ui.editingId = null;
    ui.composer = {
      parentId: n.id,
      presetIdx: 0,
      x: n.x + 370,
      y: n.y,
    };
    renderAll();
    flyToWorld(n.x + 190, n.y, Math.max(ui.zoom, 0.85));
  });

  // Drag-to-connect Cross-Industry Bridge port
  const port = el.querySelector('[data-act="bridge-port"]');
  if (port) {
    port.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      desk.classList.add('bridging');
      ui.bridgeDraft = { sourceId: n.id, x1: n.x, y1: n.y + 56, x2: n.x, y2: n.y + 90 };

      const onMove = (me) => {
        const w = screenToWorld(me.clientX, me.clientY);
        ui.bridgeDraft.x2 = w.x;
        ui.bridgeDraft.y2 = w.y;
        const { visibleIds } = computeVisibleSet(store.doc);
        renderEdges(visibleIds);
      };
      const onUp = (ue) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        desk.classList.remove('bridging');
        const targetEl = document.elementFromPoint(ue.clientX, ue.clientY)?.closest('.fission-card');
        const targetId = targetEl?.dataset?.id;
        ui.bridgeDraft = null;

        if (targetId && targetId !== n.id) {
          const label = prompt('输入这两张卡的「跨界相通点 / 复用逻辑」：', '跨界相通点 · 核心获客或履约 SOP 迁移');
          if (label && label.trim()) {
            store.checkpoint();
            store.doc.bridges.push({
              id: 'b_' + Date.now().toString(36),
              source: n.id,
              target: targetId,
              label: label.trim().slice(0, 48),
            });
            toast('已建立跨界相通点连线');
          }
        }
        renderAll();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
}

// ---- Guided First-Principles Sprout Composer ----
function buildGuidedComposer() {
  const c = ui.composer;
  const preset = FISSION_PRESETS[c.presetIdx] || FISSION_PRESETS[0];
  const box = document.createElement('div');
  box.className = 'composer-card';
  box.style.left = c.x + 'px';
  box.style.top = c.y + 'px';
  box.addEventListener('pointerdown', ev => ev.stopPropagation());

  box.innerHTML = `
    <div class="preset-tabs">
      ${FISSION_PRESETS.map((p, idx) => `
        <button class="preset-tab ${idx === c.presetIdx ? 'active' : ''}" data-pidx="${idx}">${esc(p.tab)}</button>
      `).join('')}
    </div>
    <div class="guide-prompt">${esc(preset.prompt)}</div>
    <input class="form-input" id="compTitle" maxlength="32" placeholder="${esc(preset.placeholder)}">
    <textarea class="form-textarea" id="compSummary" rows="2" placeholder="补充一句话逻辑（谁买单、怎么交付、为什么现在有机会）…"></textarea>
    <div class="form-row">
      <input class="form-input" id="compEarn" maxlength="24" placeholder="预期客单/毛利">
      <input class="form-input" id="compBarrier" maxlength="24" placeholder="核心门槛">
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
      <span style="font-size:10.5px;color:var(--color-text-muted);">算子：${esc(preset.op)}</span>
      <div style="display:flex;gap:6px;">
        <button class="pill-btn" id="compCancel">取消</button>
        <button class="pill-btn primary" id="compSubmit">生长节点 ↵</button>
      </div>
    </div>
  `;

  box.querySelectorAll('[data-pidx]').forEach(tab => {
    tab.onclick = () => {
      c.presetIdx = parseInt(tab.dataset.pidx, 10);
      renderAll();
    };
  });

  const titleInp = box.querySelector('#compTitle');
  setTimeout(() => titleInp.focus(), 20);

  const commit = () => {
    const title = titleInp.value.trim();
    if (!title) { toast('请先填写分支标题'); return; }
    store.checkpoint();
    const id = 'n_' + Date.now().toString(36);
    store.doc.nodes.push({
      id,
      type: preset.type,
      title,
      summary: box.querySelector('#compSummary').value.trim(),
      earn: box.querySelector('#compEarn').value.trim(),
      barrier: box.querySelector('#compBarrier').value.trim(),
      firstStep: '',
      risk: '',
      evidence: [false, false, false, false, false, false],
      status: 'exploring',
      killReason: '',
      did: 0,
      valid: 0,
      collapsed: false,
      x: c.x,
      y: c.y,
    });
    store.doc.edges.push({
      id: 'e_' + Date.now().toString(36),
      source: c.parentId,
      target: id,
      op: preset.op,
    });
    ui.composer = null;
    tidyDeskLayout(store.doc);
    store.saveQuiet();
    ui.selectedIds = new Set([id]);
    renderAll();
    const created = store.doc.nodes.find(x => x.id === id);
    if (created) flyToWorld(created.x, created.y, ui.zoom);
  };

  box.querySelector('#compCancel').onclick = () => { ui.composer = null; renderAll(); };
  box.querySelector('#compSubmit').onclick = commit;
  titleInp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape') { ui.composer = null; renderAll(); }
  });
  return box;
}

// ---- Double-Click In-Place Full Card Editor ----
function buildInlineEditor(n) {
  const box = document.createElement('div');
  box.className = 'composer-card';
  box.style.width = '326px';
  box.style.left = n.x + 'px';
  box.style.top = n.y + 'px';
  box.addEventListener('pointerdown', ev => ev.stopPropagation());

  const evState = Array.from({ length: 6 }, (_, i) => !!(n.evidence && n.evidence[i]));
  const parentEdge = store.doc.edges.find(e => e.target === n.id);
  const subtree = store.subtreeIdsOf(n.id);
  const candidateParents = store.doc.nodes.filter(cand => !subtree.has(cand.id) && cand.onDesk !== false);

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:11px;font-weight:600;color:var(--color-text-secondary);">原位编辑卡片</span>
      <select class="form-select" id="edStatus" style="width:auto;margin:0;padding:3px 8px;font-size:11px;">
        <option value="exploring" ${n.status === 'exploring' ? 'selected' : ''}>探索中</option>
        <option value="starred" ${n.status === 'starred' ? 'selected' : ''}>★ 重点深挖</option>
        ${n.type !== 'origin' ? `<option value="falsified" ${n.status === 'falsified' ? 'selected' : ''}>✕ 已证伪</option>` : ''}
      </select>
    </div>
    <input class="form-input" id="edTitle" value="${esc(n.title)}" placeholder="标题">
    <textarea class="form-textarea" id="edSummary" rows="2" placeholder="核心供需断层与商业逻辑">${esc(n.summary || '')}</textarea>
    <div class="form-row">
      <input class="form-input" id="edEarn" value="${esc(n.earn || '')}" placeholder="预期收益/毛利">
      <input class="form-input" id="edBarrier" value="${esc(n.barrier || '')}" placeholder="核心门槛">
    </div>
    <input class="form-input" id="edFirst" value="${esc(n.firstStep || '')}" placeholder="最小验证第一步（如：访谈3家诊所）">
    <input class="form-input" id="edRisk" value="${esc(n.status === 'falsified' ? (n.killReason || n.risk || '') : (n.risk || ''))}" placeholder="合规边界 / 若证伪请填死因">

    ${n.type !== 'origin' ? `
      <div style="margin-bottom:7px;">
        <div style="font-size:10.5px;color:var(--color-text-muted);margin-bottom:3px;">上级挂载节点（改挂父卡片）</div>
        <select class="form-select" id="edParent" style="margin:0;">
          ${candidateParents.map(cp => `
            <option value="${esc(cp.id)}" ${parentEdge && parentEdge.source === cp.id ? 'selected' : ''}>
              ${esc(cp.title)}
            </option>
          `).join('')}
        </select>
      </div>
    ` : ''}

    <div style="font-size:10.5px;color:var(--color-text-muted);">radar 6 维证据核验（点击点亮已实证项）</div>
    <div class="evidence-checks">
      ${EVIDENCE_DIMS.map((dim, idx) => `
        <button type="button" class="ev-check ${evState[idx] ? 'checked' : ''}" data-ev="${idx}">${esc(dim)}</button>
      `).join('')}
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;">
      <button type="button" class="pill-btn" id="edDelete" style="color:var(--color-danger);border-color:rgba(207,102,102,0.3);">
        ${n.type === 'origin' ? '收起归档' : '删除分支'}
      </button>
      <div style="display:flex;gap:6px;">
        <button type="button" class="pill-btn" id="edCancel">取消</button>
        <button type="button" class="pill-btn primary" id="edSave">保存</button>
      </div>
    </div>
  `;

  box.querySelectorAll('[data-ev]').forEach(btn => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.ev, 10);
      evState[i] = !evState[i];
      btn.classList.toggle('checked', evState[i]);
    };
  });

  box.querySelector('#edCancel').onclick = () => { ui.editingId = null; renderAll(); };
  box.querySelector('#edDelete').onclick = () => {
    store.checkpoint();
    if (n.type === 'origin') {
      n.onDesk = false;
      toast(`已将「${n.title}」收起归档`);
    } else {
      const delIds = store.subtreeIdsOf(n.id);
      store.doc.nodes = store.doc.nodes.filter(x => !delIds.has(x.id));
      store.doc.edges = store.doc.edges.filter(e => !delIds.has(e.source) && !delIds.has(e.target));
      store.doc.bridges = store.doc.bridges.filter(b => !delIds.has(b.source) && !delIds.has(b.target));
      toast('已删除分支（可按 Ctrl+Z 撤销）');
    }
    ui.editingId = null;
    tidyDeskLayout(store.doc);
    store.saveQuiet();
    renderAll();
  };

  box.querySelector('#edSave').onclick = () => {
    const title = box.querySelector('#edTitle').value.trim();
    if (!title) { toast('标题不能为空'); return; }
    store.checkpoint();
    n.title = title;
    n.summary = box.querySelector('#edSummary').value.trim();
    n.earn = box.querySelector('#edEarn').value.trim();
    n.barrier = box.querySelector('#edBarrier').value.trim();
    n.firstStep = box.querySelector('#edFirst').value.trim();
    const riskVal = box.querySelector('#edRisk').value.trim();
    n.status = box.querySelector('#edStatus').value;
    if (n.status === 'falsified') n.killReason = riskVal || '经测算淘汰';
    else n.risk = riskVal;
    n.evidence = evState;

    const parentSel = box.querySelector('#edParent');
    if (parentSel && parentSel.value && parentEdge && parentEdge.source !== parentSel.value) {
      parentEdge.source = parentSel.value;
      tidyDeskLayout(store.doc);
    }

    ui.editingId = null;
    store.saveQuiet();
    renderAll();
  };

  return box;
}

// ---- Minimap ----
function drawMinimap() {
  const ctx = minimapCanvas.getContext('2d');
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const { visibleIds } = computeVisibleSet(store.doc);
  const visNodes = store.doc.nodes.filter(n => visibleIds.has(n.id));
  if (!visNodes.length) return;

  let minX = -600, maxX = 600, minY = -450, maxY = 450;
  for (const n of visNodes) {
    minX = Math.min(minX, n.x - 220);
    maxX = Math.max(maxX, n.x + 220);
    minY = Math.min(minY, n.y - 160);
    maxY = Math.max(maxY, n.y + 160);
  }
  const spanX = Math.max(800, maxX - minX);
  const spanY = Math.max(550, maxY - minY);
  const scale = Math.min((w - 16) / spanX, (h - 16) / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const toMini = (wx, wy) => ({
    x: w / 2 + (wx - cx) * scale,
    y: h / 2 + (wy - cy) * scale,
  });

  minimapCanvas._meta = { cx, cy, scale, w, h };

  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--color-edge-active').trim() || '#d6a36c';
  const muted = style.getPropertyValue('--color-text-muted').trim() || '#888';

  for (const n of visNodes) {
    const p = toMini(n.x, n.y);
    ctx.fillStyle = n.type === 'origin' ? accent : muted;
    ctx.fillRect(p.x - 5, p.y - 3, n.type === 'origin' ? 11 : 8, 5);
  }

  // Viewport rectangle
  const vwLeft = (-window.innerWidth / 2 - ui.panX) / ui.zoom;
  const vwTop = (-window.innerHeight / 2 - ui.panY) / ui.zoom;
  const vwW = window.innerWidth / ui.zoom;
  const vwH = window.innerHeight / ui.zoom;
  const vp = toMini(vwLeft, vwTop);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(vp.x, vp.y, vwW * scale, vwH * scale);
}

minimapCanvas.addEventListener('click', (e) => {
  const m = minimapCanvas._meta;
  if (!m) return;
  const rect = minimapCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const wx = (mx - m.w / 2) / m.scale + m.cx;
  const wy = (my - m.h / 2) / m.scale + m.cy;
  flyToWorld(wx, wy, ui.zoom);
});

// ---- Main Render ----
function renderAll() {
  const { visibleIds, childCountMap } = computeVisibleSet(store.doc, ui.onlyStarred);
  renderOriginTabs();
  renderCards(visibleIds, childCountMap);
  renderEdges(visibleIds);
  applyTransform();
  $('undoBtn').disabled = store.undoStack.length === 0;
  $('redoBtn').disabled = store.redoStack.length === 0;
}

// ---- Desk Pan & Shift+Drag Marquee Selection ----
let panState = null;
let marqueeState = null;

desk.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.fission-card') || e.target.closest('.composer-card') || e.target.closest('.edge-pill')) return;
  ui.flyTarget = null;

  if (e.shiftKey) {
    marqueeState = { x0: e.clientX, y0: e.clientY };
    marqueeBox.style.display = 'block';
    marqueeBox.style.left = e.clientX + 'px';
    marqueeBox.style.top = e.clientY + 'px';
    marqueeBox.style.width = '0px';
    marqueeBox.style.height = '0px';
    desk.setPointerCapture(e.pointerId);
    return;
  }

  panState = { startX: e.clientX - ui.panX, startY: e.clientY - ui.panY, moved: false };
  desk.classList.add('panning');
  desk.setPointerCapture(e.pointerId);
});

desk.addEventListener('pointermove', (e) => {
  if (marqueeState) {
    const x1 = Math.min(marqueeState.x0, e.clientX);
    const y1 = Math.min(marqueeState.y0, e.clientY);
    const x2 = Math.max(marqueeState.x0, e.clientX);
    const y2 = Math.max(marqueeState.y0, e.clientY);
    marqueeBox.style.left = x1 + 'px';
    marqueeBox.style.top = y1 + 'px';
    marqueeBox.style.width = (x2 - x1) + 'px';
    marqueeBox.style.height = (y2 - y1) + 'px';

    const w1 = screenToWorld(x1, y1);
    const w2 = screenToWorld(x2, y2);
    const { visibleIds } = computeVisibleSet(store.doc);
    ui.selectedIds = new Set(
      store.doc.nodes
        .filter(n => visibleIds.has(n.id) && n.x >= w1.x && n.x <= w2.x && n.y >= w1.y && n.y <= w2.y)
        .map(n => n.id)
    );
    document.querySelectorAll('.fission-card').forEach(c => {
      c.classList.toggle('selected', ui.selectedIds.has(c.dataset.id));
    });
    return;
  }

  if (!panState) return;
  panState.moved = true;
  ui.panX = e.clientX - panState.startX;
  ui.panY = e.clientY - panState.startY;
  applyTransform();
});

desk.addEventListener('pointerup', (e) => {
  if (marqueeState) {
    marqueeState = null;
    marqueeBox.style.display = 'none';
    if (desk.hasPointerCapture(e.pointerId)) desk.releasePointerCapture(e.pointerId);
    renderOriginTabs();
    return;
  }
  if (!panState) return;
  const wasMoved = panState.moved;
  panState = null;
  desk.classList.remove('panning');
  if (desk.hasPointerCapture(e.pointerId)) desk.releasePointerCapture(e.pointerId);
  if (!wasMoved) {
    ui.selectedIds.clear();
    ui.composer = null;
    ui.editingId = null;
    renderAll();
  }
});

desk.addEventListener('wheel', (e) => {
  e.preventDefault();
  ui.flyTarget = null;
  const factor = e.deltaY < 0 ? 1.09 : 0.91;
  const next = Math.max(0.38, Math.min(2.1, ui.zoom * factor));
  const cx = e.clientX - window.innerWidth / 2;
  const cy = e.clientY - window.innerHeight / 2;
  const ratio = next / ui.zoom;
  ui.panX = cx - (cx - ui.panX) * ratio;
  ui.panY = cy - (cy - ui.panY) * ratio;
  ui.zoom = next;
  applyTransform();
}, { passive: false });

// ---- Command Palette (Cabinet Restore + 771 Dictionary Summon) ----
const paletteModal = $('paletteModal');
const paletteInput = $('paletteInput');
const paletteList = $('paletteList');

function summonOrRestore(title, cat = '新召唤赛道', archivedId = null) {
  store.checkpoint();
  let target = archivedId
    ? store.doc.nodes.find(n => n.id === archivedId)
    : store.doc.nodes.find(n => n.type === 'origin' && n.title === title);

  if (target) {
    target.onDesk = true;
  } else {
    target = {
      id: 'ind_' + Date.now().toString(36),
      type: 'origin',
      cat,
      title,
      summary: '已从行业词库请上桌面。点击右侧「+」按第一性原理提问拆解首条变现路径。',
      earn: '',
      barrier: '',
      firstStep: '',
      risk: '',
      evidence: [false, false, false, false, false, false],
      status: 'exploring',
      killReason: '',
      did: 0,
      valid: 0,
      onDesk: true,
      collapsed: false,
      x: -380,
      y: 0,
    };
    store.doc.nodes.push(target);
  }

  tidyDeskLayout(store.doc);
  store.saveQuiet();
  paletteModal.classList.remove('open');
  ui.selectedIds = new Set([target.id]);
  renderAll();
  flyToWorld(target.x + 140, target.y, 0.86);
  toast(`「${target.title}」已放到桌面`);
}

function renderPalette(q = '') {
  const kw = q.trim().toLowerCase();
  const archived = store.doc.nodes.filter(n =>
    n.type === 'origin' && n.onDesk === false
    && (!kw || n.title.toLowerCase().includes(kw) || (n.cat || '').toLowerCase().includes(kw))
  );

  const onDeskNames = new Set(store.doc.nodes.filter(n => n.type === 'origin' && n.onDesk !== false).map(n => n.title));
  const poolMatches = ui.industryPool
    .filter(item => !onDeskNames.has(item.name) && (!kw || item.name.toLowerCase().includes(kw) || (item.cat || '').toLowerCase().includes(kw)))
    .slice(0, 22);

  let html = '';
  if (kw && !store.doc.nodes.some(n => n.title.toLowerCase() === kw) && !ui.industryPool.some(i => i.name.toLowerCase() === kw)) {
    html += `<div class="palette-group-label">新建自定义赛道</div>
      <div class="palette-row" data-custom="${esc(q.trim())}">
        <span>直接创建「<b>${esc(q.trim())}</b>」放到桌面</span>
        <span class="palette-meta">新建原点 ↵</span>
      </div>`;
  }

  if (archived.length) {
    html += `<div class="palette-group-label">归档柜（之前推演过并收起的行业，一键恢复整棵树）</div>`;
    html += archived.map(a => {
      const count = store.subtreeIdsOf(a.id).size;
      return `<div class="palette-row" data-restore="${esc(a.id)}">
        <span>${esc(a.title)}</span>
        <span class="palette-meta">${esc(a.cat || '未分类')} · 含 ${count} 张卡 · 恢复上桌</span>
      </div>`;
    }).join('');
  }

  html += `<div class="palette-group-label">后台 771 行业词库（回车请上桌面推演）</div>`;
  html += poolMatches.map(item => `
    <div class="palette-row" data-summon="${esc(item.name)}" data-cat="${esc(item.cat || '未分类')}">
      <span>${esc(item.name)}</span>
      <span class="palette-meta">${esc(item.cat || '未分类')} · 请上桌面</span>
    </div>
  `).join('');

  paletteList.innerHTML = html;
  paletteList.querySelectorAll('.palette-row').forEach(row => {
    row.onclick = () => {
      if (row.dataset.restore) summonOrRestore('', '', row.dataset.restore);
      else if (row.dataset.custom) summonOrRestore(row.dataset.custom, '自定义赛道');
      else summonOrRestore(row.dataset.summon, row.dataset.cat);
    };
  });
}

function openPalette() {
  paletteModal.classList.add('open');
  paletteInput.value = '';
  renderPalette('');
  setTimeout(() => paletteInput.focus(), 20);
}

// ---- Export Markdown Brief Modal ----
const briefModal = $('briefModal');
function openBriefModal() {
  const firstSel = Array.from(ui.selectedIds)[0];
  const fallbackOrigin = store.doc.nodes.find(n => n.type === 'origin' && n.onDesk !== false);
  const targetId = firstSel || (fallbackOrigin && fallbackOrigin.id);
  if (!targetId) { toast('当前桌面暂无可导出的行业'); return; }
  $('briefTextarea').value = store.exportBriefMarkdown(targetId);
  briefModal.classList.add('open');
}

// ---- Toolbar & Keyboard Bindings ----
$('openPaletteBtn').onclick = openPalette;
$('exportBriefBtn').onclick = openBriefModal;
$('tidyLayoutBtn').onclick = () => {
  store.checkpoint();
  tidyDeskLayout(store.doc);
  store.saveQuiet();
  renderAll();
  toast('已自动避让并理顺桌面排布');
};
$('starFilterBtn').onclick = (e) => {
  ui.onlyStarred = !ui.onlyStarred;
  e.currentTarget.classList.toggle('active', ui.onlyStarred);
  renderAll();
};
$('undoBtn').onclick = () => { if (store.undo()) { renderAll(); toast('已撤销'); } };
$('redoBtn').onclick = () => { if (store.redo()) { renderAll(); toast('已重做'); } };
$('zoomInBtn').onclick = () => { ui.zoom = Math.min(2.1, ui.zoom * 1.15); applyTransform(); };
$('zoomOutBtn').onclick = () => { ui.zoom = Math.max(0.38, ui.zoom * 0.86); applyTransform(); };
function fitAllCards(animate = false) {
  const { visibleIds } = computeVisibleSet(store.doc);
  const vis = store.doc.nodes.filter(n => visibleIds.has(n.id));
  if (!vis.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of vis) {
    minX = Math.min(minX, n.x - 165);
    maxX = Math.max(maxX, n.x + 165);
    minY = Math.min(minY, n.y - 110);
    maxY = Math.max(maxY, n.y + 110);
  }
  const availW = Math.max(320, window.innerWidth - 96);
  const availH = Math.max(280, window.innerHeight - 175);
  const nextZoom = Math.max(0.5, Math.min(0.95, Math.min(availW / (maxX - minX), availH / (maxY - minY))));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 + 12;
  if (animate) {
    flyToWorld(cx, cy, nextZoom);
  } else {
    ui.zoom = nextZoom;
    ui.panX = -cx * nextZoom;
    ui.panY = -cy * nextZoom;
    applyTransform();
  }
}

$('zoomReadout').onclick = () => { fitAllCards(true); };
$('themeSelect').onchange = (e) => applyTheme(e.target.value);

// ---- Live Radar Coverage Matrix, One-Click Probe & Commercial Claims Modal ----
const radarModal = $('radarModal');
const CLAIM_CAT_LABEL = {
  pricing: '客单 / 毛利',
  cac: '获客成本',
  demand: '需求实证',
  delivery: '履约交付',
  compliance: '合规红线',
};
const REASON_LABEL = {
  single_source: '单源/同域上限 0.55',
  no_verified_source: '缺少 web 原文核验',
  unsupported_by_sources: '来源未覆盖该模块',
  unsupported_by_verified_sources: '已核验源未覆盖',
  no_quote: '缺少原文引文',
  proprietary_reference: '含专有商业许可来源 (上限 0.40)',
  contradiction: '存在矛盾主张 (contested)',
};

async function refreshRadarPacks() {
  try {
    const res = await fetch('/api/radar/packs');
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.packs)) {
      ui.radarPacks = data.packs;
      renderAll();
    }
  } catch (_) {}
}

function getBranchNodesForOrigin(originId) {
  const ids = store.subtreeIdsOf(originId);
  return store.doc.nodes.filter(x => ids.has(x.id) && x.id !== originId);
}

async function openRadarModal(node) {
  ui.radarModal.nodeId = node.id;
  ui.radarModal.probeMode = !node.radarPack;
  const currentSlug = node.radarPack || '';
  ui.radarModal.pack = currentSlug;
  ui.radarModal.tab = 'matrix';
  radarModal.classList.add('open');

  $('radarModalTitle').textContent = `radar 证据审计 · ${node.title}`;
  renderRadarPackSelector(currentSlug);

  if (!currentSlug) {
    renderProbeComposer(node);
  } else {
    await loadRadarPackDetail(currentSlug);
  }
}

function renderRadarPackSelector(selectedSlug) {
  const sel = $('radarPackSelect');
  sel.innerHTML = `<option value="">（未绑定 / 新建探针）</option>` + ui.radarPacks.map(p =>
    `<option value="${esc(p.pack)}" ${p.pack === selectedSlug ? 'selected' : ''}>${esc(p.pack)} · ${esc(p.title)}</option>`
  ).join('');
}

function renderProbeComposer(node) {
  ui.radarModal.probeMode = true;
  const branches = getBranchNodesForOrigin(node.id).filter(b => b.status !== 'falsified');
  const suggestedSlug = String(node.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || ('probe-' + node.id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10));

  $('radarModalSub').textContent = '一键将当前桌面分支翻译为 radar pack.json 并启动首轮公网搜证';
  $('radarSummaryBar').innerHTML = `
    <span class="lvl-badge lvl-evidence">画布转探针</span>
    <span style="color:var(--color-text-secondary);">检测到 <b>${branches.length}</b> 张有效下游分支卡，将自动映射为 radar 审计模块</span>
  `;

  $('radarBody').innerHTML = `
    <div class="inline-panel" style="margin-top:0;">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;">⚡ 为「${esc(node.title)}」生成 radar 行业探针</div>
      <div class="form-row">
        <div>
          <label style="display:block;font-size:11px;color:var(--color-text-muted);margin-bottom:4px;">Pack 标识（英文小写/短横线）</label>
          <input class="form-input" id="probeSlug" value="${esc(suggestedSlug)}" placeholder="如: rpa-automation">
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--color-text-muted);margin-bottom:4px;">GitHub 检索关键词（选填，逗号分隔）</label>
          <input class="form-input" id="probeGhQueries" placeholder="例: ${esc(node.title)} in:readme">
        </div>
      </div>
      <label style="display:block;font-size:11px;color:var(--color-text-muted);margin-bottom:4px;">已知公开竞品 / 标准 / 报价单 URL（选填，每行一条，将自动抓取并原文核验）</label>
      <textarea class="form-textarea" id="probeUrls" rows="3" placeholder="https://github.com/...\nhttps://..."></textarea>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:4px;">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--color-text-secondary);cursor:pointer;">
          <input type="checkbox" id="probeRunGh" checked> 同步检索 GitHub 公开开源实现作为首轮种子
        </label>
        <button class="pill-btn primary" id="launchProbeBtn">一键生成 pack 并跑首轮搜证</button>
      </div>
    </div>
    <div style="margin-top:12px;font-size:11.5px;color:var(--color-text-muted);">
      将映射的分支卡片：${branches.length ? branches.map(b => `<span class="spec-pill" style="margin-right:4px;">${esc(b.title)}</span>`).join('') : '（当前尚无子分支，将自动生成 4 个标准商业核验模块：获客 / 定价 / 交付 / 合规）'}
    </div>
  `;

  $('launchProbeBtn').onclick = async () => {
    const btn = $('launchProbeBtn');
    const slug = $('probeSlug').value.trim().toLowerCase();
    const ghRaw = $('probeGhQueries').value.trim();
    const urls = $('probeUrls').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const runGithub = $('probeRunGh').checked;

    btn.disabled = true;
    btn.textContent = '正在生成 pack 并运行 radar 搜证…';
    try {
      const res = await fetch('/api/radar/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          title: node.title,
          originNode: node,
          branchNodes: branches,
          githubQueries: ghRaw ? ghRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
          seedUrls: urls,
          runGithub,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      store.checkpoint();
      node.radarPack = data.pack;
      store.saveQuiet();
      ui.radarModal.probeMode = false;
      ui.radarModal.pack = data.pack;
      ui.radarModal.detail = data.detail;
      ui.radarModal.tab = 'matrix';
      await refreshRadarPacks();
      renderRadarPackSelector(data.pack);
      renderRadarModalContent();
      toast(`探针 ${data.pack} 已生成并完成首轮 radar 搜证`);
    } catch (err) {
      toast('探针生成失败: ' + err.message);
      btn.disabled = false;
      btn.textContent = '一键生成 pack 并跑首轮搜证';
    }
  };
}

async function loadRadarPackDetail(slug) {
  ui.radarModal.probeMode = false;
  ui.radarModal.pack = slug;
  if (!slug) {
    const node = store.doc.nodes.find(x => x.id === ui.radarModal.nodeId);
    if (node) renderProbeComposer(node);
    return;
  }
  $('radarSummaryBar').textContent = `正在读取 ${slug} 的覆盖度矩阵、商业主张与来源账本…`;
  try {
    const res = await fetch('/api/radar/runs/' + encodeURIComponent(slug));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const detail = await res.json();
    ui.radarModal.detail = detail;
    renderRadarModalContent();
  } catch (err) {
    $('radarSummaryBar').textContent = '读取 radar 数据失败: ' + err.message;
    $('radarBody').innerHTML = '';
  }
}

function renderRadarModalContent() {
  if (ui.radarModal.probeMode) return;
  const detail = ui.radarModal.detail;
  if (!detail) return;
  const cov = detail.coverage;
  if (!cov) {
    $('radarSummaryBar').innerHTML = `该分析包（<b>${esc(detail.pack)}</b>）尚无运行结果，请点击右上角「运行 radar 重算」。`;
    $('radarBody').innerHTML = '';
    return;
  }

  const sum = cov.summary || {};
  const clSum = (detail.claims && detail.claims.summary) || { total: 0, high: 0, contested: 0 };
  $('radarModalSub').textContent = `${(detail.packSpec && detail.packSpec.title) || detail.pack} · 最近审计 ${detail.state && detail.state.created_at ? detail.state.created_at.slice(0, 19).replace('T', ' ') : '已就绪'}`;
  $('radarSummaryBar').innerHTML = `
    <span class="lvl-badge lvl-strong">STRONG ${sum.strong || 0}</span>
    <span class="lvl-badge lvl-evidence">EVIDENCE ${sum.evidence || 0}</span>
    <span class="lvl-badge lvl-mention">MENTION ${sum.mention || 0}</span>
    <span class="lvl-badge lvl-none">NONE ${sum.none || 0}</span>
    <span class="lvl-badge" style="background:var(--color-background-card);color:var(--color-text-primary);border:1px solid var(--color-border);">主张 ${clSum.total} (高信 ${clSum.high}${clSum.contested ? ` · 矛盾 ${clSum.contested}` : ''})</span>
    <span style="margin-left:auto;color:var(--color-text-secondary);">核验来源 <b>${cov.sources || 0}</b> 条</span>
  `;

  document.querySelectorAll('[data-rtab]').forEach(t => {
    t.classList.toggle('active', t.dataset.rtab === ui.radarModal.tab);
  });

  const body = $('radarBody');
  const units = [...(cov.modules || []), ...(cov.subsystems || [])];

  if (ui.radarModal.tab === 'matrix') {
    body.innerHTML = `<div class="matrix-grid">${units.map(u => {
      const lvlCls = 'lvl-' + (u.level || 'none');
      return `<div class="matrix-cell">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font:600 11px var(--font-mono);color:var(--color-text-muted);">${esc(u.id)} · ${u.kind === 'subsystem' ? '子系统' : '模块'}</span>
          <span class="lvl-badge ${lvlCls}">${esc(u.level)}</span>
        </div>
        <div style="font-size:13.5px;font-weight:600;margin-bottom:6px;">${esc(u.name)}</div>
        <div style="font-size:11px;color:var(--color-text-secondary);">
          ${u.source_count || 0} 条来源 · ${u.independent_count || 0} 独立源
          ${u.single_source ? '<span style="color:var(--color-starred);margin-left:4px;">(单源待印证)</span>' : ''}
        </div>
        <div style="font:10.5px var(--font-mono);color:var(--color-text-muted);margin-top:5px;">
          ${(u.sources || []).length ? esc(u.sources.join(', ')) : '暂无覆盖来源'}
        </div>
      </div>`;
    }).join('')}</div>`;
  } else if (ui.radarModal.tab === 'claims') {
    const claims = (detail.claims && detail.claims.claims) || [];
    const sources = detail.sources || [];
    const claimsHtml = claims.length ? claims.map(c => {
      const confCls = 'conf-' + (c.label || 'low');
      const catText = CLAIM_CAT_LABEL[c.category] || '商业主张';
      const reasons = (c.reasons || []).map(r => REASON_LABEL[r] || r);
      const nextAct = !reasons.length ? '可进入执行与报价底稿'
        : reasons.includes('存在矛盾主张 (contested)') ? '复核矛盾来源'
        : (c.reasons || []).includes('proprietary_reference') ? '换可复用来源或人工复核许可'
        : (c.reasons || []).includes('single_source') ? '补充第 2 个独立域名来源'
        : '补强原文核验来源';
      return `<div class="claim-card ${c.status === 'contested' ? 'contested' : ''}">
        <div class="claim-head">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font:600 11px var(--font-mono);color:var(--color-text-muted);">${esc(c.id)}</span>
            <span class="spec-pill">${esc(catText)}</span>
            ${c.metric ? `<span class="spec-pill" style="color:var(--color-text-primary);">${esc(c.metric)}</span>` : ''}
          </div>
          <span class="conf-pill ${confCls}">置信度 ${Number(c.confidence || 0).toFixed(2)} · ${esc(c.label || 'low')} · ${esc(c.status || 'open')}</span>
        </div>
        <div style="font-size:13px;line-height:1.55;margin-bottom:7px;">${esc(c.statement)}</div>
        <div style="font-size:11px;color:var(--color-text-secondary);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <span>覆盖：<b>${esc((c.covers || []).join(', '))}</b> · 引用：<b>${esc((c.sources || []).join(', '))}</b>（${c.distinct_hosts || 0} 独立域）</span>
          <span style="color:var(--color-edge-active);">下一步：${esc(nextAct)}</span>
        </div>
        ${reasons.length ? `<div style="font-size:10.5px;color:var(--color-text-muted);margin-top:4px;">扣分/限顶原因：${esc(reasons.join(' / '))}</div>` : ''}
      </div>`;
    }).join('') : '<div style="color:var(--color-text-muted);font-size:12.5px;margin-bottom:10px;">该分析包尚无商业主张记录，请在下方添加一条关于客单价、获客成本或合规红线的判断，由 radar 规则引擎自动算出置信度。</div>';

    body.innerHTML = `
      ${claimsHtml}
      <div class="inline-panel">
        <div style="font-size:12.5px;font-weight:700;margin-bottom:8px;">➕ 新增商业主张并立即用 radar claims 审计置信度</div>
        <div class="form-row">
          <select class="form-select" id="newClaimCat">
            <option value="pricing">客单 / 毛利定价</option>
            <option value="cac">获客成本 / 渠道</option>
            <option value="demand">真实需求验证</option>
            <option value="delivery">履约交付效率</option>
            <option value="compliance">合规与许可红线</option>
          </select>
          <input class="form-input" id="newClaimMetric" maxlength="40" placeholder="关键指标（例：¥198–398/单）">
        </div>
        <textarea class="form-textarea" id="newClaimStmt" rows="2" placeholder="写一句可证伪的商业主张（如：三甲医院陪诊按次计价可行，且存在明确非诊疗合规红线）…"></textarea>
        <div style="font-size:11px;color:var(--color-text-muted);">选择覆盖模块（至少 1 项）：</div>
        <div class="chip-picker" id="claimCoverPicker">
          ${units.map((u, i) => `<button type="button" class="pick-chip ${i === 0 ? 'on' : ''}" data-cid="${esc(u.id)}">${esc(u.id)} ${esc(u.name)}</button>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--color-text-muted);">勾选支撑来源（选 ≥2 个不同域名来源才可能达 high）：</div>
        <div class="chip-picker" id="claimSrcPicker">
          ${sources.slice(0, 18).map((s, i) => `<button type="button" class="pick-chip ${i === 0 ? 'on' : ''}" data-sid="${esc(s.id)}" title="${esc(s.title || s.url)}">${esc(s.id)}</button>`).join('')}
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button class="pill-btn primary" id="submitClaimBtn">写入并运行 radar claims 审计</button>
        </div>
      </div>
    `;

    body.querySelectorAll('#claimCoverPicker .pick-chip, #claimSrcPicker .pick-chip').forEach(ch => {
      ch.onclick = () => ch.classList.toggle('on');
    });

    $('submitClaimBtn').onclick = async () => {
      const statement = $('newClaimStmt').value.trim();
      const covers = Array.from(body.querySelectorAll('#claimCoverPicker .pick-chip.on')).map(el => el.dataset.cid);
      const srcs = Array.from(body.querySelectorAll('#claimSrcPicker .pick-chip.on')).map(el => el.dataset.sid);
      if (!statement) { toast('请填写商业主张内容'); return; }
      if (!covers.length || !srcs.length) { toast('请至少选择 1 个覆盖模块和 1 条支撑来源'); return; }
      const btn = $('submitClaimBtn');
      btn.disabled = true;
      btn.textContent = '规则引擎计算中…';
      try {
        const res = await fetch('/api/radar/claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pack: detail.pack,
            addClaim: {
              category: $('newClaimCat').value,
              metric: $('newClaimMetric').value.trim(),
              statement,
              covers,
              sources: srcs,
            },
          }),
        });
        const evalData = await res.json();
        if (!res.ok) throw new Error(evalData.error || ('HTTP ' + res.status));
        ui.radarModal.detail.claims = evalData;
        renderRadarModalContent();
        await refreshRadarPacks();
        toast('已通过 radar claims 规则引擎完成置信度审计');
      } catch (err) {
        toast('商业主张审计失败: ' + err.message);
        btn.disabled = false;
        btn.textContent = '写入并运行 radar claims 审计';
      }
    };
  } else if (ui.radarModal.tab === 'sources') {
    const list = detail.sources || [];
    body.innerHTML = `
      <div class="inline-panel" style="margin-top:0;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">➕ 贴入新 URL 自动抓证（调用 radar draft + 原文核验）</div>
        <div style="display:flex;gap:8px;">
          <input class="form-input" id="draftUrlInput" style="margin:0;flex:1;" placeholder="粘贴 GitHub 仓库或公开文档/报价页 https://…">
          <button class="pill-btn primary" id="draftUrlBtn">抓证并重算</button>
        </div>
      </div>
    ` + (list.map(s => `
      <div class="source-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <div>
            <span style="font:600 11px var(--font-mono);color:var(--color-edge-active);margin-right:6px;">${esc(s.id)}</span>
            <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:13px;color:var(--color-text-primary);text-decoration:underline;">${esc(s.title || s.url)}</a>
          </div>
          <span class="spec-pill">${esc(s.platform || 'web')} · ${esc(s.evidence_level || '')} · ${esc(s.license || 'unknown')}</span>
        </div>
        ${(s.quotes && s.quotes[0]) ? `<div class="source-quote">“${esc(s.quotes[0])}”</div>` : ''}
        <div style="font-size:11.5px;color:var(--color-text-secondary);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <span>覆盖单元：<b>${esc((s.covers || []).join(', '))}</b></span>
          <span>${s.quote_verified === 'true' ? '已原文核验 (' + esc(s.quote_verified_by || 'web') + ')' : '待核验'}</span>
        </div>
        ${s.limitations ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">边界限制：${esc(Array.isArray(s.limitations) ? s.limitations.join('; ') : s.limitations)}</div>` : ''}
      </div>
    `).join('') || '<div style="color:var(--color-text-muted);">暂无来源条目</div>');

    $('draftUrlBtn').onclick = async () => {
      const u = $('draftUrlInput').value.trim();
      if (!/^https?:\/\//.test(u)) { toast('请输入以 http:// 或 https:// 开头的有效 URL'); return; }
      const btn = $('draftUrlBtn');
      btn.disabled = true;
      btn.textContent = '抓取核验中…';
      try {
        const res = await fetch('/api/radar/draft-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack: detail.pack, urls: [u] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        ui.radarModal.detail = data.detail;
        renderRadarModalContent();
        await refreshRadarPacks();
        toast(`已抓取 ${data.added} 条新来源并重算覆盖度`);
      } catch (err) {
        toast('抓证失败: ' + err.message);
        btn.disabled = false;
        btn.textContent = '抓证并重算';
      }
    };
  } else {
    body.innerHTML = `<pre style="margin:0;white-space:pre-wrap;font:12px/1.65 var(--font-mono);color:var(--color-text-secondary);user-select:text;">${esc(detail.gapsMarkdown || '当前无空白模块缺口记录。')}</pre>`;
  }
}

$('radarProbeModeBtn').onclick = () => {
  const node = store.doc.nodes.find(x => x.id === ui.radarModal.nodeId);
  if (node) renderProbeComposer(node);
};

$('radarPackSelect').onchange = async (e) => {
  const slug = e.target.value;
  const node = store.doc.nodes.find(x => x.id === ui.radarModal.nodeId);
  if (node) {
    store.checkpoint();
    node.radarPack = slug;
    store.saveQuiet();
    renderAll();
  }
  await loadRadarPackDetail(slug);
};

$('radarRunBtn').onclick = async () => {
  const slug = ui.radarModal.pack;
  if (!slug) { toast('请先选择要运行的 radar pack，或点击新建探针'); return; }
  const btn = $('radarRunBtn');
  btn.disabled = true;
  btn.textContent = '审计运行中…';
  try {
    const res = await fetch('/api/radar/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: slug }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    ui.radarModal.detail = data;
    ui.radarModal.probeMode = false;
    renderRadarModalContent();
    await refreshRadarPacks();
    toast(`已完成 ${slug} 的 radar 覆盖度与主张重算`);
  } catch (err) {
    toast('运行失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '运行 radar 重算';
  }
};

$('radarCloseBtn').onclick = () => radarModal.classList.remove('open');
radarModal.addEventListener('click', e => { if (e.target === radarModal) radarModal.classList.remove('open'); });
document.querySelectorAll('[data-rtab]').forEach(btn => {
  btn.onclick = () => {
    ui.radarModal.probeMode = false;
    ui.radarModal.tab = btn.dataset.rtab;
    renderRadarModalContent();
  };
});

$('copyBriefBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('briefTextarea').value);
    toast('已复制 Markdown 行动与取证简报');
  } catch (_) {
    $('briefTextarea').select();
    document.execCommand('copy');
    toast('已复制简报');
  }
};
$('closeBriefBtn').onclick = () => briefModal.classList.remove('open');

paletteModal.addEventListener('click', e => { if (e.target === paletteModal) paletteModal.classList.remove('open'); });
briefModal.addEventListener('click', e => { if (e.target === briefModal) briefModal.classList.remove('open'); });
paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') paletteModal.classList.remove('open');
  if (e.key === 'Enter') {
    const first = paletteList.querySelector('.palette-row');
    if (first) first.click();
  }
});

window.addEventListener('keydown', (e) => {
  const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (!inInput && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) { if (store.redo()) { renderAll(); toast('已重做'); } }
    else { if (store.undo()) { renderAll(); toast('已撤销'); } }
    return;
  }
  if (e.key === 'Escape') {
    paletteModal.classList.remove('open');
    briefModal.classList.remove('open');
    radarModal.classList.remove('open');
    ui.composer = null;
    ui.editingId = null;
    renderAll();
  }
});

// ---- Boot ----
applyTheme(store.doc.theme || 'stone-dark', false);
fitAllCards(false);
renderAll();
tickCamera();

store.loadFromServer().then((loaded) => {
  if (loaded) {
    applyTheme(store.doc.theme || 'stone-dark', false);
    fitAllCards(false);
    renderAll();
  }
});
refreshRadarPacks();

fetch('/api/industries?all=true')
  .then(r => (r.ok ? r.json() : null))
  .then(d => {
    if (d && Array.isArray(d.industries)) {
      ui.industryPool = d.industries;
      renderOriginTabs();
    }
  })
  .catch(() => {});
