/* 商机广场 3D 行业星空 */
(() => {
  // @ASSUMPTION: candidate industries are curated client-side for the visual prototype; claimed state comes from /api/industries.
  // @UNCERTAIN: persistent claiming requires identity and ownership APIs that are intentionally outside task #50.
  const CANDIDATES = [
    'AI 行业','本地生活','宠物服务','银发经济','低空经济','机器人','新能源','跨境电商','内容创作','在线教育',
    '心理健康','家庭服务','户外运动','游戏娱乐','短剧','数字人','智能硬件','无人零售','社区商业','餐饮服务',
    '旅游体验','乡村产业','农业科技','工业软件','企业服务','数据服务','网络安全','绿色消费','循环经济','个人护理',
    '母婴服务','儿童成长','职业培训','灵活用工','法律服务','财税服务','物流配送','汽车服务','房屋租赁','空间改造',
    '医疗健康','营养管理','睡眠经济','情绪消费','兴趣社群','婚恋服务','摄影影像','设计服务','知识付费','独立开发',
    '弱点行业','养老服务','家居生活','美妆个护','服装定制','文旅文创','直播电商','供应链服务','金融科技','保险服务'
  ];
  const state = { ready: false, visible: false, scene: null, camera: null, renderer: null, group: null, stars: [], data: [], hovered: null, dragging: false, moved: false, lastX: 0, lastY: 0, targetRX: -.12, targetRY: 0, pointer: new THREE.Vector2(), raycaster: new THREE.Raycaster(), frame: 0 };
  const host = document.getElementById('galaxyCanvas');
  const tooltip = document.getElementById('galaxyTooltip');
  const focus = document.getElementById('galaxyFocus');

  function glowTexture(color) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'); const g = ctx.createRadialGradient(64,64,0,64,64,64);
    g.addColorStop(0, color); g.addColorStop(.14, color); g.addColorStop(.38, color.replace('1)', '.34)')); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,128,128); return new THREE.CanvasTexture(canvas);
  }

  function init() {
    if (state.ready || !window.THREE) return;
    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.FogExp2(0x030607, .0038);
    state.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .1, 1400);
    state.camera.position.set(0, 8, 145);
    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    state.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); state.renderer.setSize(innerWidth, innerHeight);
    state.renderer.outputColorSpace = THREE.SRGBColorSpace; host.appendChild(state.renderer.domElement);
    state.group = new THREE.Group(); state.scene.add(state.group);
    bindEvents(); state.ready = true; animate();
  }

  function makeStar(item, index, total, claimedTextures) {
    const phi = Math.acos(1 - 2 * (index + .5) / total), theta = Math.PI * (1 + Math.sqrt(5)) * index;
    const radius = 36 + (index % 7) * 6.8;
    const position = new THREE.Vector3(radius * Math.sin(phi) * Math.cos(theta) * 1.42, radius * Math.cos(phi) * .76, radius * Math.sin(phi) * Math.sin(theta));
    const claimed = !!item.claimed;
    const size = claimed ? 2.15 + Math.min(item.nodeCount || 0, 14) * .045 : .72 + index % 4 * .15;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 14, 14), new THREE.MeshBasicMaterial({ color: claimed ? 0xf6efcf : 0xb7c8c8 }));
    mesh.position.copy(position); mesh.userData = item; mesh.userData.baseSize = size;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: claimed ? claimedTextures.claimed : claimedTextures.pending, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(claimed ? size * 8.5 : size * 5); mesh.add(glow);
    state.group.add(mesh); state.stars.push(mesh);
  }

  function render(industries) {
    init(); if (!state.ready) return;
    state.stars.forEach(star => { state.group.remove(star); star.geometry.dispose(); star.material.dispose(); }); state.stars = [];
    const byName = new Map(industries.map(item => [item.name, item]));
    state.data = CANDIDATES.map((name, index) => { const live = byName.get(name); return live ? { ...live, claimed: true } : { id: `candidate-${index}`, name, claimed: false, nodeCount: 0, radius: 0, note: '这颗行业星尚未被认领。认领后，建立它的第一条商机路径。' }; });
    industries.filter(item => !CANDIDATES.includes(item.name)).forEach(item => state.data.push({ ...item, claimed: true }));
    const textures = { claimed: glowTexture('rgba(255,238,171,1)'), pending: glowTexture('rgba(159,205,211,1)') };
    state.data.forEach((item, index) => makeStar(item, index, state.data.length, textures));
    document.getElementById('galaxyTotal').textContent = state.data.length;
    document.getElementById('galaxyClaimed').textContent = industries.length;
    document.getElementById('galaxyPending').textContent = state.data.filter(item => !item.claimed).length;
  }

  function projectPosition(star) {
    const p = new THREE.Vector3(); star.getWorldPosition(p); p.project(state.camera);
    return { x: (p.x * .5 + .5) * innerWidth, y: (-p.y * .5 + .5) * innerHeight };
  }

  function pick(event) {
    const rect = state.renderer.domElement.getBoundingClientRect();
    state.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    state.raycaster.setFromCamera(state.pointer, state.camera);
    return state.raycaster.intersectObjects(state.stars, false)[0]?.object || null;
  }

  function onMove(event) {
    if (state.dragging) { const dx = event.clientX - state.lastX, dy = event.clientY - state.lastY; state.lastX = event.clientX; state.lastY = event.clientY; if (Math.abs(dx)+Math.abs(dy)>2) state.moved = true; state.targetRY += dx * .004; state.targetRX += dy * .003; return; }
    const star = pick(event); if (state.hovered && state.hovered !== star) state.hovered.scale.setScalar(1);
    state.hovered = star; host.style.cursor = star ? 'pointer' : 'grab';
    if (!star) { tooltip.classList.remove('show'); return; }
    star.scale.setScalar(star.userData.claimed ? 1.18 : 1.45); const p = projectPosition(star);
    tooltip.style.left = `${p.x}px`; tooltip.style.top = `${p.y}px`;
    tooltip.innerHTML = `<b>${star.userData.name}</b><span class="${star.userData.claimed ? 'claimed' : ''}">${star.userData.claimed ? '已认领 · 点击进入' : '待认领 · 点击靠近'}</span>`; tooltip.classList.add('show');
  }

  function onClick(event) {
    if (state.moved) return; const star = pick(event); if (!star) { focus.classList.remove('show'); return; }
    const item = star.userData; const p = projectPosition(star);
    focus.style.left = `${Math.min(innerWidth - 310, Math.max(18, p.x + 28))}px`; focus.style.top = `${Math.min(innerHeight - 210, Math.max(82, p.y - 55))}px`;
    focus.innerHTML = `<small>${item.claimed ? 'CLAIMED INDUSTRY' : 'UNCLAIMED INDUSTRY'}</small><h2>${item.name}</h2><p>${item.claimed ? `${item.nodeCount} 个商机信号 · 裂变半径 ${item.radius}` : item.note}</p><button id="galaxyAction">${item.claimed ? '进入行业星系' : '认领这颗行业星'}</button>`;
    focus.classList.add('show');
    document.getElementById('galaxyAction').onclick = () => {
      if (item.claimed) location.hash = '#/i/' + item.id;
      else { document.getElementById('n-name').value = item.name; document.getElementById('newPanel').classList.add('open'); focus.classList.remove('show'); }
    };
  }

  function bindEvents() {
    host.addEventListener('pointerdown', e => { state.dragging = true; state.moved = false; state.lastX = e.clientX; state.lastY = e.clientY; host.setPointerCapture(e.pointerId); });
    host.addEventListener('pointermove', onMove); host.addEventListener('pointerup', e => { state.dragging = false; host.releasePointerCapture(e.pointerId); onClick(e); });
    host.addEventListener('wheel', e => { e.preventDefault(); state.camera.position.z = THREE.MathUtils.clamp(state.camera.position.z + e.deltaY * .055, 68, 230); }, { passive: false });
    addEventListener('resize', () => { if (!state.ready) return; state.camera.aspect = innerWidth / innerHeight; state.camera.updateProjectionMatrix(); state.renderer.setSize(innerWidth, innerHeight); });
  }

  function animate(time = 0) {
    state.frame = requestAnimationFrame(animate); if (!state.visible) return;
    state.group.rotation.x += (THREE.MathUtils.clamp(state.targetRX, -.7, .7) - state.group.rotation.x) * .06;
    state.group.rotation.y += (state.targetRY - state.group.rotation.y) * .06; state.targetRY += .00035;
    state.stars.forEach((star, index) => { const pulse = 1 + Math.sin(time * .0014 + index) * (star.userData.claimed ? .045 : .09); if (star !== state.hovered) star.scale.setScalar(pulse); });
    state.renderer.render(state.scene, state.camera);
  }

  window.renderIndustryGalaxy = render;
  window.setIndustryGalaxyVisible = visible => { state.visible = visible; host.style.display = visible ? 'block' : 'none'; if (!visible) { tooltip.classList.remove('show'); focus.classList.remove('show'); } };
})();