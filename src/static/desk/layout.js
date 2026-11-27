// Non-overlapping Tree Layout Engine, Subtree Visibility, and Magnetic Snap Guides

export const COL_GAP = 385;
export const SIBLING_GAP = 34;
export const TREE_GAP = 112;

export function estimateCardHeight(node) {
  if (node.status === 'falsified') {
    const reasonLines = Math.max(1, Math.ceil(String(node.killReason || node.risk || '').length / 18));
    return 66 + reasonLines * 18;
  }
  const titleLines = Math.max(1, Math.ceil(String(node.title || '').length / 13));
  const summaryLines = Math.max(1, Math.ceil(String(node.summary || '').length / 17));
  const specRows = (node.earn ? 1 : 0) + (node.barrier ? 1 : 0) + (node.radarPack || node.type === 'origin' ? 1 : 0);
  const specHeight = specRows >= 2 ? 48 : (specRows === 1 ? 26 : 0);
  return 92 + titleLines * 22 + summaryLines * 20 + specHeight;
}

/**
 * Compute visible node map taking into account `onDesk` origins and `collapsed` ancestors.
 */
export function computeVisibleSet(doc, onlyStarred = false) {
  const nodeMap = new Map(doc.nodes.map(n => [n.id, n]));
  const childrenMap = new Map();
  for (const e of doc.edges) {
    if (!childrenMap.has(e.source)) childrenMap.set(e.source, []);
    childrenMap.get(e.source).push(e.target);
  }

  const visibleIds = new Set();
  const childCountMap = new Map();

  function countDescendants(id, visiting = new Set()) {
    if (childCountMap.has(id)) return childCountMap.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let total = 0;
    for (const ch of childrenMap.get(id) || []) {
      if (visiting.has(ch)) continue;
      total += 1 + countDescendants(ch, visiting);
    }
    visiting.delete(id);
    childCountMap.set(id, total);
    return total;
  }

  const origins = doc.nodes.filter(n => n.type === 'origin');
  for (const o of origins) {
    countDescendants(o.id);
    if (o.onDesk === false) continue;

    const queue = [o.id];
    const bfsVisited = new Set();
    while (queue.length) {
      const curId = queue.shift();
      if (bfsVisited.has(curId)) continue;
      bfsVisited.add(curId);
      const cur = nodeMap.get(curId);
      if (!cur) continue;
      visibleIds.add(curId);
      if (cur.collapsed) continue;
      for (const chId of childrenMap.get(curId) || []) {
        if (!bfsVisited.has(chId)) queue.push(chId);
      }
    }
  }

  // Also keep any orphan non-origin node unless archived
  for (const n of doc.nodes) {
    if (n.type !== 'origin' && !doc.edges.some(e => e.target === n.id) && n.onDesk !== false) {
      visibleIds.add(n.id);
    }
  }

  return { visibleIds, childrenMap, childCountMap, onlyStarred };
}

/**
 * Tidy up all on-desk trees so zero sibling or cousin cards ever collide vertically or horizontally.
 */
export function tidyDeskLayout(doc, baseX = -380) {
  const { visibleIds, childrenMap } = computeVisibleSet(doc);
  const nodeMap = new Map(doc.nodes.map(n => [n.id, n]));
  const subtreeSpan = new Map();

  function measure(id, visited = new Set()) {
    if (visited.has(id)) return 180;
    visited.add(id);
    const n = nodeMap.get(id);
    if (!n) return 0;
    const ownH = estimateCardHeight(n);
    if (n.collapsed) {
      subtreeSpan.set(id, ownH);
      return ownH;
    }
    const kids = (childrenMap.get(id) || []).filter(cid => visibleIds.has(cid));
    if (!kids.length) {
      subtreeSpan.set(id, ownH);
      return ownH;
    }
    let sum = 0;
    kids.forEach((cid, i) => {
      if (i > 0) sum += SIBLING_GAP;
      sum += measure(cid, visited);
    });
    const span = Math.max(ownH, sum);
    subtreeSpan.set(id, span);
    return span;
  }

  function place(id, depth, centerY, visited = new Set()) {
    if (visited.has(id)) return;
    visited.add(id);
    const n = nodeMap.get(id);
    if (!n) return;
    n.x = baseX + depth * COL_GAP;
    n.y = Math.round(centerY);
    if (n.collapsed) return;

    const kids = (childrenMap.get(id) || []).filter(cid => visibleIds.has(cid));
    if (!kids.length) return;
    const totalKidsH = kids.reduce((acc, cid, i) => acc + (i > 0 ? SIBLING_GAP : 0) + (subtreeSpan.get(cid) || 180), 0);
    let cursorY = centerY - totalKidsH / 2;
    for (const cid of kids) {
      const kh = subtreeSpan.get(cid) || 180;
      place(cid, depth + 1, cursorY + kh / 2, visited);
      cursorY += kh + SIBLING_GAP;
    }
  }

  const activeOrigins = doc.nodes.filter(n => n.type === 'origin' && visibleIds.has(n.id));
  activeOrigins.forEach(o => measure(o.id));
  const totalDeskH = activeOrigins.reduce(
    (acc, o, i) => acc + (i > 0 ? TREE_GAP : 0) + (subtreeSpan.get(o.id) || 200),
    0
  );
  let cursorTreeY = -totalDeskH / 2 + 20;
  for (const o of activeOrigins) {
    const span = subtreeSpan.get(o.id) || 200;
    place(o.id, 0, cursorTreeY + span / 2);
    cursorTreeY += span + TREE_GAP;
  }
}

/**
 * Compute magnetic alignment snap (within threshold) against other visible cards.
 */
export function computeSnap(movingIds, rawX, rawY, visibleNodes, threshold = 8) {
  let snappedX = rawX;
  let snappedY = rawY;
  let guideX = null;
  let guideY = null;

  for (const other of visibleNodes) {
    if (movingIds.has(other.id)) continue;
    if (guideX === null && Math.abs(other.x - rawX) <= threshold) {
      snappedX = other.x;
      guideX = other.x;
    }
    if (guideY === null && Math.abs(other.y - rawY) <= threshold) {
      snappedY = other.y;
      guideY = other.y;
    }
    if (guideX !== null && guideY !== null) break;
  }

  return { x: snappedX, y: snappedY, guideX, guideY };
}
