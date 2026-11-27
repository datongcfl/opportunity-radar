// State, Undo/Redo History Stack, Desk/Cabinet Lifecycle, and Markdown/Radar Brief Exporter

export const EVIDENCE_DIMS = [
  '痛点实证',
  '客单定价',
  '获客渠道',
  '交付SOP',
  '成本毛利',
  '合规边界',
];

export const ROLE_META = {
  origin:   { label: '行业原点', color: 'var(--role-origin)' },
  monetize: { label: '变现路径', color: 'var(--role-monetize)' },
  skill:    { label: '核心技能', color: 'var(--role-skill)' },
  scenario: { label: '切入场景', color: 'var(--role-scenario)' },
  tool:     { label: '效率工具', color: 'var(--role-tool)' },
};

export const FISSION_PRESETS = [
  {
    type: 'monetize',
    op: '断层 → 变现',
    tab: '变现路径',
    prompt: '第一性原理追问：谁在为此掏钱？现有方案慢在哪、贵在哪或没人愿意接？',
    placeholder: '例：宠物医院出院后的居家皮下补液护理包',
  },
  {
    type: 'scenario',
    op: '人群 → 场景',
    tab: '细分场景',
    prompt: '第一性原理追问：换一拨更急迫、对价格更不敏感的买单人群是谁？',
    placeholder: '例：异地工作子女为独居父母买的陪诊纪要服务',
  },
  {
    type: 'skill',
    op: '交付 → 技能',
    tab: '关键技能',
    prompt: '第一性原理追问：把交付做稳、让客户敢复购的核心手艺或 SOP 是什么？',
    placeholder: '例：进门直播留痕 + 每日体征拍照核对单',
  },
  {
    type: 'tool',
    op: '提效 → 工具',
    tab: '落地工具',
    prompt: '第一性原理追问：哪个高频重复环节能做成清单、脚本或小工具卖给同行？',
    placeholder: '例：一户一码进门打卡水印小程序',
  },
];

const STORAGE_KEY = 'opp_radar_spatial_desk_v5';

export function createInitialDoc() {
  return {
    theme: 'stone-dark',
    nodes: [
      {
        id: 'pet', type: 'origin', cat: '宠物', title: '宠物伴护与专科服务',
        summary: '标准洗护已红海，但“高信任上门照护 + 术后老年慢病居家护理”存在明显供需断层。',
        earn: '毛利 55%–70%', barrier: '本地口碑冷启动',
        firstStep: '先跑通 3 个中高端小区熟人转介绍样板单',
        risk: '严守非诊疗边界，全程录像签免责协议',
        evidence: [true, true, true, true, true, false],
        radarPack: 'pet-hospital',
        status: 'exploring', killReason: '',
        did: 14, valid: 19,
        onDesk: true, collapsed: false,
        x: -380, y: -110,
      },
      {
        id: 'pet_m1', type: 'monetize', title: '术后与老年犬猫居家护理包',
        summary: '承接医院出院后无人会打皮下补液、换药与喂药的断层，按周收费。',
        earn: '¥600–1,800 / 周', barrier: '兽医助理实操经验',
        firstStep: '与 2 家社区宠物医院谈出院护理转介分成',
        risk: '仅执行医嘱护理，不越界开处方',
        evidence: [true, true, false, true, true, false],
        status: 'starred', killReason: '',
        did: 6, valid: 11,
        collapsed: false,
        x: 0, y: -230,
      },
      {
        id: 'pet_m2', type: 'monetize', title: '节假日高信任留守巡访',
        summary: '春节与长假刚需，提供进门直播、喂食铲屎与应激状态评估。',
        earn: '单长假 ¥8k–1.5w', barrier: '强履约 SOP',
        firstStep: '设计次抛鞋套 + 进门视频打卡标准模板',
        risk: '服务半径超 3 公里会严重吞噬单日产能',
        evidence: [true, true, true, true, true, false],
        status: 'exploring', killReason: '',
        did: 23, valid: 21,
        collapsed: false,
        x: 0, y: -10,
      },
      {
        id: 'pet_m3', type: 'monetize', title: '全品类低价宠物粮社区团购',
        summary: '试图靠拼团低价切入宠主日常消耗品。',
        earn: '毛利 < 8%', barrier: '供应链压货',
        firstStep: '',
        risk: '电商大促常态化补贴，线下团长毫无价格优势且售后损耗高',
        evidence: [true, true, false, false, true, false],
        status: 'falsified', killReason: '电商补贴倒挂，毛利不足 8% 且压货重，已证伪淘汰',
        did: 3, valid: 0,
        collapsed: false,
        x: 0, y: 175,
      },
      {
        id: 'pet_s1', type: 'skill', title: '医嘱居家护理标准化核对单',
        summary: '将喂药剂量、体温、排泄拍照做成一页式交付日报，消除宠主焦虑。',
        earn: '转介绍率 +40%', barrier: '表单结构化能力',
        firstStep: '整理 10 类常见术后异常观察阈值表',
        risk: '发现指标越界需第一时间送返原医院',
        evidence: [true, false, false, true, false, true],
        status: 'exploring', killReason: '',
        did: 4, valid: 7,
        collapsed: false,
        x: 370, y: -300,
      },
      {
        id: 'pet_t1', type: 'tool', title: '一户一码进门打卡存证小工具',
        summary: 'NFC 门贴一碰自动记录进出门时间与视频水印，可向同行上门服务者订阅售卖。',
        earn: 'SaaS ¥199 / 年', barrier: '轻量小程序开发',
        firstStep: '先用现成多维表格表单跑通 20 单验证留痕体验',
        risk: '客户家庭隐私画面需自动定期清理',
        evidence: [true, true, false, false, false, false],
        status: 'starred', killReason: '',
        did: 2, valid: 5,
        collapsed: false,
        x: 370, y: -120,
      },

      // Second Origin on Desk
      {
        id: 'elder', type: 'origin', cat: '康养心理', title: '独居银发陪诊与代办',
        summary: '异地子女付费意愿强、本地交付高度分散，核心壁垒是可核验的在场信任。',
        earn: '¥198–398 / 半天', barrier: '熟悉三甲科室动线',
        firstStep: '实测跑通本地 2 家核心三甲医院科室动线图',
        risk: '不做任何医疗诊断建议，聚焦流程陪护与沟通传译',
        evidence: [true, true, true, true, false, false],
        radarPack: 'elder-care',
        status: 'exploring', killReason: '',
        did: 18, valid: 16,
        onDesk: true, collapsed: false,
        x: -380, y: 340,
      },
      {
        id: 'elder_sc1', type: 'scenario', title: '异地子女“代问诊+医嘱通俗纪要”',
        summary: '子女最痛的不是挂号，而是老人听不懂医嘱、报喜不报忧。',
        earn: '客单溢价 +¥120', barrier: '信息提炼沟通力',
        firstStep: '打磨一页式家属语音+图文就诊反馈模板',
        risk: '诊室录音需提前礼貌征得医生同意',
        evidence: [true, true, false, true, false, false],
        status: 'starred', killReason: '',
        did: 9, valid: 12,
        collapsed: false,
        x: 0, y: 340,
      },

      // Pre-archived example in Cabinet ("已收进柜子的历史推演") so user can test instant restore!
      {
        id: 'solar', type: 'origin', cat: '维修养护', title: '县域屋顶光伏清洗与巡检',
        summary: '存量分布式光伏积灰导致发电掉 15%+，农户自己不敢爬顶清洗。',
        earn: '¥3–5 / 块板', barrier: '高空作业安全证与水电设备',
        firstStep: '找当地光伏安装商谈售后维保外包分润',
        risk: '冬季防滑与组件隐裂责任界定',
        evidence: [true, true, false, false, true, false],
        status: 'exploring', killReason: '',
        did: 5, valid: 8,
        onDesk: false, collapsed: false,
        x: -380, y: 640,
      },
    ],
    edges: [
      { id: 'e1', source: 'pet', target: 'pet_m1', op: '断层 → 变现' },
      { id: 'e2', source: 'pet', target: 'pet_m2', op: '场景 → 变现' },
      { id: 'e3', source: 'pet', target: 'pet_m3', op: '流量 → 变现' },
      { id: 'e4', source: 'pet_m1', target: 'pet_s1', op: '交付 → 技能' },
      { id: 'e5', source: 'pet_m1', target: 'pet_t1', op: '信任 → 工具' },
      { id: 'e6', source: 'elder', target: 'elder_sc1', op: '痛点 → 场景' },
    ],
    bridges: [
      {
        id: 'b1',
        source: 'pet_m2',
        target: 'elder_sc1',
        label: '跨界相通点 · 异地委托人的在场存证 SOP 复用',
      },
    ],
  };
}

export class DeskStore {
  constructor() {
    this.doc = this._load();
    this.undoStack = [];
    this.redoStack = [];
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
          return parsed;
        }
      }
    } catch (_) {}
    return createInitialDoc();
  }

  saveQuiet() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
    } catch (_) {}
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      fetch('/api/desk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.doc),
      }).catch(() => {});
    }, 320);
  }

  async loadFromServer() {
    try {
      const res = await fetch('/api/desk');
      if (!res.ok) return false;
      const data = await res.json();
      if (data && data.doc && Array.isArray(data.doc.nodes) && data.doc.nodes.length) {
        this.doc = data.doc;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc)); } catch (_) {}
        return true;
      }
    } catch (_) {}
    return false;
  }

  checkpoint() {
    this.undoStack.push(JSON.stringify(this.doc));
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
    this.saveQuiet();
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.undoStack.pop());
    this.saveQuiet();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.redoStack.pop());
    this.saveQuiet();
    return true;
  }

  resetDemo() {
    this.checkpoint();
    this.doc = createInitialDoc();
    this.saveQuiet();
  }

  rootOriginOf(nodeId) {
    const parentByTarget = new Map(this.doc.edges.map(e => [e.target, e.source]));
    let cur = nodeId;
    const guard = new Set();
    while (parentByTarget.has(cur) && !guard.has(cur)) {
      guard.add(cur);
      cur = parentByTarget.get(cur);
    }
    return this.doc.nodes.find(n => n.id === cur) || null;
  }

  subtreeIdsOf(rootId) {
    const adj = new Map();
    for (const e of this.doc.edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source).push(e.target);
    }
    const out = new Set([rootId]);
    const q = [rootId];
    while (q.length) {
      const cur = q.shift();
      for (const nx of adj.get(cur) || []) {
        if (!out.has(nx)) {
          out.add(nx);
          q.push(nx);
        }
      }
    }
    return out;
  }

  /**
   * Generate structured Markdown action & radar evidence brief for a node's branch.
   */
  exportBriefMarkdown(targetNodeId) {
    const origin = this.rootOriginOf(targetNodeId) || this.doc.nodes.find(n => n.id === targetNodeId);
    if (!origin) return '';
    const ids = this.subtreeIdsOf(origin.id);
    const branchNodes = this.doc.nodes.filter(n => ids.has(n.id));
    const parentEdge = new Map(this.doc.edges.map(e => [e.target, e]));

    const lines = [];
    lines.push(`# 商机推演与取证简报：${origin.title}`);
    lines.push(`> 所属分类：${origin.cat || '未分类'} | 生成自「商机嗅探器 · 空间推演台」`);
    lines.push('');

    const starred = branchNodes.filter(n => n.status === 'starred');
    if (starred.length) {
      lines.push('## 一、重点深挖主航道（★ Starred）');
      for (const n of starred) {
        const missing = EVIDENCE_DIMS.filter((_, idx) => !(n.evidence && n.evidence[idx]));
        lines.push(`### ★ ${n.title}（${(ROLE_META[n.type] || {}).label || n.type}）`);
        lines.push(`- **核心逻辑**：${n.summary || '待补充'}`);
        lines.push(`- **预期收益 / 门槛**：${n.earn || '待测算'} / ${n.barrier || '待评估'}`);
        lines.push(`- **最小验证第一步**：${n.firstStep || '待明确'}`);
        lines.push(`- **风险与合规边界**：${n.risk || '待核查'}`);
        lines.push(`- **radar 待补证据缺口**：${missing.length ? missing.join('、') : '6 项维度已齐备'}`);
        lines.push('');
      }
    }

    lines.push('## 二、全部分支结构与证据进度');
    for (const n of branchNodes) {
      const pe = parentEdge.get(n.id);
      const prefix = pe ? `  - [${pe.op}] ` : '- **[原点]** ';
      const filled = (n.evidence || []).filter(Boolean).length;
      const statusLabel = n.status === 'starred' ? '★重点' : (n.status === 'falsified' ? `✕已证伪(${n.killReason || '走不通'})` : '探索中');
      lines.push(`${prefix}**${n.title}** · ${statusLabel} · 证据 ${filled}/6`);
    }

    const relatedBridges = this.doc.bridges.filter(b => ids.has(b.source) || ids.has(b.target));
    if (relatedBridges.length) {
      lines.push('');
      lines.push('## 三、跨界相通点（SOP 与能力迁移）');
      for (const b of relatedBridges) {
        const s = this.doc.nodes.find(n => n.id === b.source);
        const t = this.doc.nodes.find(n => n.id === b.target);
        if (s && t) lines.push(`- **${s.title}** ⇄ **${t.title}**：${b.label}`);
      }
    }

    return lines.join('\n');
  }
}
