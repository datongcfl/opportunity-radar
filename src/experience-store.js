const fs = require('fs');
const path = require('path');
const { clip, uid, readBody, send, safeDecode } = require('./http-utils');

const EXP_CATEGORIES = new Set([
  '政务办事', '车管业务', '户籍业务', '社保公积金', '医疗健康',
  '教育入学', '房产相关', '营业执照', '税务相关', '司法公证', '其他办事',
]);

/**
 * Sanitize step pitfalls or solutions list, ignoring null or empty items.
 * @param {unknown} rawList
 * @returns {Array<{ text: string, author: string, addedAt: string }>}
 */
function sanitizeNotes(rawList) {
  if (!Array.isArray(rawList)) return [];
  const now = new Date().toISOString();
  const out = [];
  for (const item of rawList) {
    if (out.length >= 10) break;
    if (typeof item === 'string') {
      const text = clip(item, 500);
      if (text) out.push({ text, author: '原文', addedAt: now });
    } else if (item && typeof item === 'object') {
      const text = clip(item.text, 500);
      if (text) out.push({ text, author: clip(item.author, 20) || '原文', addedAt: now });
    }
  }
  return out;
}

/**
 * Create a decoupled local-experience store and HTTP route handler backed by `dataDir`.
 * @param {{ dataDir: string }} options
 */
function createExperienceStore({ dataDir }) {
  const EXP_FILE = path.join(dataDir, 'experiences.json');

  function loadExperiences() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(EXP_FILE)) {
      fs.writeFileSync(EXP_FILE, '[]', 'utf8');
      return [];
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(EXP_FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
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
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const tmp = EXP_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, EXP_FILE);
  }

  /**
   * Handle `/api/experiences*` routes; return true if handled.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {URL} url
   */
  async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/experiences') {
      const city = clip(url.searchParams.get('city'), 20) || '';
      const category = clip(url.searchParams.get('category'), 20) || '';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      let list = loadExperiences();
      if (city) list = list.filter(e => e.city === city);
      if (category) list = list.filter(e => e.category === category);
      if (q) {
        list = list.filter(e =>
          (e.title || '').toLowerCase().includes(q)
          || (e.tags || []).some(t => String(t).toLowerCase().includes(q))
          || (e.steps || []).some(s =>
            (s.title || '').toLowerCase().includes(q)
            || (s.content || '').toLowerCase().includes(q)
          )
        );
      }
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      send(res, 200, { experiences: list });
      return true;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/experiences/')) {
      const id = safeDecode(url.pathname.slice('/api/experiences/'.length));
      if (!id || id.includes('/')) {
        send(res, 404, { error: '经验不存在' });
        return true;
      }
      const exp = loadExperiences().find(e => e.id === id);
      if (!exp) {
        send(res, 404, { error: '经验不存在' });
        return true;
      }
      send(res, 200, exp);
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/experiences') {
      const b = await readBody(req);
      const title = clip(b.title, 60);
      const city = clip(b.city, 20);
      const category = clip(b.category, 20);
      const author = clip(b.author, 20) || '匿名';
      const steps = Array.isArray(b.steps) ? b.steps.slice(0, 20) : [];
      const tags = Array.isArray(b.tags)
        ? b.tags.map(t => clip(t, 15)).filter(Boolean).slice(0, 10)
        : [];
      if (!title || !city || !category) {
        send(res, 400, { error: '标题、城市、分类为必填项' });
        return true;
      }
      if (!EXP_CATEGORIES.has(category)) {
        send(res, 400, { error: '分类不在可选范围内' });
        return true;
      }
      const validSteps = steps.filter(s => s && typeof s === 'object' && typeof s.title === 'string' && s.title.trim());
      if (validSteps.length === 0) {
        send(res, 400, { error: '至少填写一个有效步骤（每个步骤必须有标题）' });
        return true;
      }
      const cleanSteps = validSteps.map(s => ({
        title: clip(s.title, 60),
        content: clip(s.content, 2000),
        duration: clip(s.duration, 30) || '未知',
        cost: clip(s.cost, 30) || '未知',
        pitfalls: sanitizeNotes(s.pitfalls),
        solutions: sanitizeNotes(s.solutions),
      }));
      const now = new Date().toISOString();
      const exp = {
        id: uid('ex_'),
        title,
        city,
        category,
        author,
        createdAt: now,
        updatedAt: now,
        totalDuration: clip(b.totalDuration, 30) || '未知',
        totalCost: clip(b.totalCost, 30) || '未知',
        steps: cleanSteps,
        supplements: [],
        tags,
      };
      const list = loadExperiences();
      list.push(exp);
      saveExperiences(list);
      send(res, 201, exp);
      return true;
    }

    if (
      req.method === 'POST'
      && url.pathname.startsWith('/api/experiences/')
      && url.pathname.endsWith('/supplement')
    ) {
      const id = safeDecode(url.pathname.slice('/api/experiences/'.length, -'/supplement'.length));
      if (!id || id.includes('/')) {
        send(res, 404, { error: '经验不存在' });
        return true;
      }
      const b = await readBody(req);
      const type = clip(b.type, 10);
      const content = clip(b.content, 1000);
      const author = clip(b.author, 20) || '匿名';
      if (!content) {
        send(res, 400, { error: '补充内容不能为空' });
        return true;
      }
      if (!['update', 'pitfall', 'solution', 'general'].includes(type)) {
        send(res, 400, { error: '补充类型非法，可选：update/pitfall/solution/general' });
        return true;
      }
      const list = loadExperiences();
      const exp = list.find(e => e.id === id);
      if (!exp) {
        send(res, 404, { error: '经验不存在' });
        return true;
      }

      let stepIndex = null;
      if (b.stepIndex !== undefined && b.stepIndex !== null && b.stepIndex !== '') {
        let parsedIdx;
        if (typeof b.stepIndex === 'number') {
          parsedIdx = Number.isInteger(b.stepIndex) ? b.stepIndex : NaN;
        } else {
          const rawStr = String(b.stepIndex).trim();
          parsedIdx = /^\d+$/.test(rawStr) ? parseInt(rawStr, 10) : NaN;
        }
        if (!Number.isInteger(parsedIdx) || parsedIdx < 0 || parsedIdx >= (exp.steps || []).length) {
          send(res, 400, { error: '步骤索引超出范围或格式非法' });
          return true;
        }
        stepIndex = parsedIdx;
      }

      const now = new Date().toISOString();
      const supp = { stepIndex, type, content, author, createdAt: now };
      exp.supplements = exp.supplements || [];
      exp.supplements.push(supp);

      if (stepIndex !== null && exp.steps[stepIndex]) {
        const step = exp.steps[stepIndex];
        if (type === 'pitfall') {
          step.pitfalls = step.pitfalls || [];
          step.pitfalls.push({ text: content, author, addedAt: now });
        } else if (type === 'solution') {
          step.solutions = step.solutions || [];
          step.solutions.push({ text: content, author, addedAt: now });
        }
      }

      exp.updatedAt = now;
      saveExperiences(list);
      send(res, 201, exp);
      return true;
    }

    return false;
  }

  return {
    loadExperiences,
    saveExperiences,
    handle,
  };
}

module.exports = {
  EXP_CATEGORIES,
  createExperienceStore,
};
