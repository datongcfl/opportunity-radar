// 商机嗅探器 MVP · 种子图谱
// 节点类型：origin 原点 / skill 技能 / monetize 变现 / scenario 场景 / tool 工具
// visible=false 的节点为待裂变层：点击父节点后展开（动态生长）
//
// 2026-07-20 按用户要求删除：
//   - ai 行业整支（23 节点 + 24 边，含原点/变现/技能/场景/工具及二阶裂变）
//   - imrrxuc8k 行业（「弱点行业」原点 + 「海康威视新出的运维工具」子节点 + 1 边，匿名灌的红包广告 spam）
// graph.json 已同步清空（文件保留，防止 loadGraph 从本文件重播）。
const T = {
  origin: 'origin', skill: 'skill', monetize: 'monetize', scenario: 'scenario', tool: 'tool'
};

const nodes = [
];

const edges = [
];

module.exports = { nodes, edges, TYPES: T };
