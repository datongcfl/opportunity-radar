const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createApp, serveStatic } = require('../src/server');
const { EXP_CATEGORIES } = require('../src/experience-store');

function createTestSeed() {
  return {
    TYPES: {
      origin: 'origin',
      skill: 'skill',
      monetize: 'monetize',
      scenario: 'scenario',
      tool: 'tool',
    },
    nodes: [
      { id: 'ind_pet', name: '宠物服务', type: 'origin', visible: true, claimed: true, note: '高复购陪伴赛道' },
      { id: 'n_m1', name: '上门喂养', type: 'monetize', visible: true },
      { id: 'n_s1', name: '门店预约小程序', type: 'tool', visible: false },
    ],
    edges: [
      { source: 'ind_pet', target: 'n_m1', op: '能力→变现', visible: true },
      { source: 'n_m1', target: 'n_s1', op: '场景→工具', visible: false },
    ],
  };
}

async function startTempServer(seed = createTestSeed()) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opp-radar-test-'));
  fs.writeFileSync(
    path.join(tmpDir, 'industries-360.json'),
    JSON.stringify([
      { name: '农业电商', cat: '农林牧渔' },
      { name: '农业电商', cat: '农林牧渔' }, // intentional duplicate to verify deduplication
      { name: '跨境电商', cat: '零售电商' },
    ]),
    'utf8'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'industries-extra.json'),
    JSON.stringify([
      { name: '农业电商', cat: '重复类目' },
      { name: '在线教育', cat: '教育' },
    ]),
    'utf8'
  );

  const app = createApp({ dataDir: tmpDir, seed });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    tmpDir,
    baseUrl,
    port: addr.port,
    close: async () => {
      await new Promise((resolve) => app.server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

test('plaza seeds dedupe cleanly and support claim + graph fission loop', async () => {
  const srv = await startTempServer();
  try {
    // Default list hides dormant extra origins
    const listRes = await fetch(`${srv.baseUrl}/api/industries`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    const names = listData.industries.map(i => i.name);
    assert.ok(names.includes('宠物服务'));
    assert.ok(names.includes('农业电商'));
    assert.equal(names.filter(n => n === '农业电商').length, 1);
    assert.equal(names.includes('在线教育'), false);

    // ?all=true exposes dormant origins cleanly with claimed=false
    const allRes = await fetch(`${srv.baseUrl}/api/industries?all=true`);
    const allData = await allRes.json();
    const dormantEdu = allData.industries.find(i => i.name === '在线教育');
    assert.ok(dormantEdu);
    assert.equal(dormantEdu.dormant, true);
    assert.equal(dormantEdu.claimed, false);

    // Claiming dormant extra industry wakes it up without 409
    const claimRes = await fetch(`${srv.baseUrl}/api/industries/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: dormantEdu.id,
        firstTouch: '成人考证伴学训练营',
        note: '高客单督学转化',
        author: 'tester',
      }),
    });
    assert.equal(claimRes.status, 201);
    const claimData = await claimRes.json();
    assert.equal(claimData.id, dormantEdu.id);

    // Graph view loads claimed industry + expanded children
    const gRes = await fetch(`${srv.baseUrl}/api/graph?industry=ind_pet`);
    assert.equal(gRes.status, 200);
    const gData = await gRes.json();
    const monetizeNode = gData.nodes.find(n => n.id === 'n_m1');
    assert.ok(monetizeNode);
    assert.equal(monetizeNode.hasMore, true);

    // Expand hidden child edge
    const expRes = await fetch(`${srv.baseUrl}/api/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'n_m1' }),
    });
    assert.equal(expRes.status, 200);
    const expData = await expRes.json();
    assert.ok(expData.nodes.some(n => n.id === 'n_s1'));

    // Add two nodes rapidly back-to-back without ID collision
    const n1Res = await fetch(`${srv.baseUrl}/api/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '宠物洗护订阅卡',
        type: 'monetize',
        parentId: 'ind_pet',
        op: '能力→变现',
      }),
    });
    const n2Res = await fetch(`${srv.baseUrl}/api/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '宠主信任评估清单',
        type: 'skill',
        parentId: 'n_m1',
        op: '需求→技能',
      }),
    });
    assert.equal(n1Res.status, 201);
    assert.equal(n2Res.status, 201);
    const n1Data = await n1Res.json();
    const n2Data = await n2Res.json();
    assert.notEqual(n1Data.created, n2Data.created);

    // Marks update cleanly
    const mRes = await fetch(`${srv.baseUrl}/api/marks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'n_m1', kind: 'valid' }),
    });
    assert.equal(mRes.status, 200);
    const mData = await mRes.json();
    assert.equal(mData.nodes.find(n => n.id === 'n_m1').marks.valid, 1);
  } finally {
    await srv.close();
  }
});

test('security and malformed input guards return 4xx without crashing server', async () => {
  const net = require('node:net');
  const srv = await startTempServer();
  try {
    // HTTP/1.0 without Host header + HTTP/1.1 with invalid Host characters must never crash server
    const sendRawHttp = (payload) => new Promise((resolve, reject) => {
      const sock = net.connect(srv.port, '127.0.0.1', () => sock.end(payload));
      let raw = '';
      sock.on('data', chunk => { raw += chunk.toString('utf8'); });
      sock.on('end', () => {
        const m = raw.match(/^HTTP\/\d\.\d\s+(\d{3})/m);
        resolve(m ? parseInt(m[1], 10) : 0);
      });
      sock.on('error', reject);
    });

    const http10NoHost = await sendRawHttp('GET /api/industries HTTP/1.0\r\n\r\n');
    assert.equal(http10NoHost, 200);

    const badHost = await sendRawHttp('GET /api/industries HTTP/1.1\r\nHost: invalid host/bad\r\nConnection: close\r\n\r\n');
    assert.equal(badHost, 200);

    // Malformed JSON -> 400 (not 500)
    const badJson = await fetch(`${srv.baseUrl}/api/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    assert.equal(badJson.status, 400);

    // Null JSON body -> 400 (not TypeError 500)
    const nullBody = await fetch(`${srv.baseUrl}/api/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    assert.equal(nullBody.status, 400);

    // Multi-byte UTF-8 body exceeding 65536 bytes even when char count < 65536 -> 413
    const bigChinese = '中'.repeat(30000); // 90,000 UTF-8 bytes
    const bigRes = await fetch(`${srv.baseUrl}/api/industries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', firstTouch: 'path', note: bigChinese }),
    });
    assert.equal(bigRes.status, 413);

    // Static traversal over raw HTTP must never leak outside static dir; direct serveStatic rejects with 403
    const rawTraversal = await sendRawHttp('GET /%2e%2e/package.json HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    assert.ok(rawTraversal === 403 || rawTraversal === 404);

    let directStatus = 0;
    serveStatic(
      { writeHead(code) { directStatus = code; }, end() {} },
      path.join(__dirname, '..', 'src', 'static'),
      '/../../package.json'
    );
    assert.equal(directStatus, 403);

    const badUri = await fetch(`${srv.baseUrl}/%ZZ`);
    assert.equal(badUri.status, 400);
  } finally {
    await srv.close();
  }
});

test('decoupled experience endpoints align categories and validate stepIndex', async () => {
  const srv = await startTempServer();
  try {
    assert.ok(EXP_CATEGORIES.has('政务办事'));

    // Create experience with 政务办事 & null elements in pitfalls/solutions (must not crash 500)
    const createRes = await fetch(`${srv.baseUrl}/api/experiences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '港澳通行证续签',
        city: '杭州',
        category: '政务办事',
        steps: [{
          title: '线下自助签注机办理',
          content: '带身份证与通行证',
          pitfalls: [null, '部分网点周末机器维护'],
          solutions: [null, { text: '提前查开放网点' }],
        }],
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.steps[0].pitfalls.length, 1);
    assert.equal(created.steps[0].solutions.length, 1);

    // Reject non-numeric & out-of-range stepIndex cleanly with 400
    for (const badIdx of ['abc', -1, 5]) {
      const badRes = await fetch(`${srv.baseUrl}/api/experiences/${created.id}/supplement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'pitfall', content: '补充测试', stepIndex: badIdx }),
      });
      assert.equal(badRes.status, 400);
    }

    // Valid stepIndex updates step pitfalls
    const okRes = await fetch(`${srv.baseUrl}/api/experiences/${created.id}/supplement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pitfall', content: '排队超过30分钟', stepIndex: 0 }),
    });
    assert.equal(okRes.status, 201);
    const updated = await okRes.json();
    assert.equal(updated.steps[0].pitfalls.length, 2);
  } finally {
    await srv.close();
  }
});

test('static frontend pages load locally with zero external CDN scripts', async () => {
  const srv = await startTempServer();
  try {
    for (const staticPath of [
      '/', '/index.html', '/galaxy.html', '/experience.html', '/concept-b.html',
      '/desk/tokens.css', '/desk/state.js', '/desk/layout.js', '/desk/desk-app.js',
      '/vendor/three/three.module.js', '/vendor/three/OrbitControls.js',
    ]) {
      const res = await fetch(`${srv.baseUrl}${staticPath}`);
      assert.equal(res.status, 200, `Expected 200 for ${staticPath}`);
      const text = await res.text();
      if (staticPath.endsWith('.html') || staticPath === '/') {
        assert.equal(/https?:\/\/cdn\./i.test(text), false, `Found prohibited CDN link in ${staticPath}`);
      }
    }
  } finally {
    await srv.close();
  }
});

test('desk persistence and radar bridge execute cleanly in isolated temp dir', async () => {
  const srv = await startTempServer();
  try {
    // 1. Desk GET (empty) -> PUT -> GET roundtrip
    const initDesk = await (await fetch(`${srv.baseUrl}/api/desk`)).json();
    assert.equal(initDesk.doc, null);

    const putRes = await fetch(`${srv.baseUrl}/api/desk`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'matcha',
        nodes: [{ id: 'o1', type: 'origin', title: '测试赛道', radarPack: 'mini-test', x: 10, y: 20 }],
        edges: [],
        bridges: [],
      }),
    });
    assert.equal(putRes.status, 200);

    const savedDesk = await (await fetch(`${srv.baseUrl}/api/desk`)).json();
    assert.equal(savedDesk.doc.theme, 'matcha');
    assert.equal(savedDesk.doc.nodes[0].radarPack, 'mini-test');

    // 2. Create a minimal workspace pack in tmpDir and run real radar bridge if sibling radar exists
    const wsPackDir = path.join(srv.tmpDir, 'radar-workspace', 'packs', 'mini-test');
    const wsSeedsDir = path.join(srv.tmpDir, 'radar-workspace', 'seeds');
    fs.mkdirSync(wsPackDir, { recursive: true });
    fs.mkdirSync(wsSeedsDir, { recursive: true });
    fs.writeFileSync(path.join(wsPackDir, 'pack.json'), JSON.stringify({
      schema_version: 1,
      pack: 'mini-test',
      version: '0.1.0',
      title: '最小桥接测试包',
      modules: [{ id: 'M01', name: '预约流程', artifacts: ['预约单'], keywords: ['预约'] }],
      subsystems: [{ id: 'S01', name: '客户端', artifacts: ['小程序'], keywords: ['小程序'] }],
    }), 'utf8');
    fs.writeFileSync(path.join(wsSeedsDir, 'mini-test.json'), JSON.stringify({
      schema_version: 1,
      pack: 'mini-test',
      sources: [{
        id: 'MT-001',
        platform: 'github',
        url: 'https://github.com/example/demo',
        title: 'Demo Repo',
        artifact_type: 'code',
        access_status: 'public',
        license: 'MIT',
        license_status: 'clear',
        evidence_level: 'real_artifact',
        covers: ['M01', 'S01'],
        quotes: ['提供完整的在线预约下单与微信小程序客户端流程实现，包含自动化测试与部署脚本。'],
        status: 'selected',
      }],
    }), 'utf8');

    const packsRes = await (await fetch(`${srv.baseUrl}/api/radar/packs`)).json();
    assert.ok(packsRes.packs.some(p => p.pack === 'mini-test'));

    if (packsRes.available) {
      const runRes = await fetch(`${srv.baseUrl}/api/radar/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: 'mini-test', title: '测试审计' }),
      });
      assert.equal(runRes.status, 200);
      const runDetail = await runRes.json();
      assert.equal(runDetail.pack, 'mini-test');
      assert.equal(runDetail.coverage.sources, 1);
      assert.equal(runDetail.coverage.modules[0].id, 'M01');
    }
  } finally {
    await srv.close();
  }
});
