# 本地经验分享平台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在商机嗅探器基础上叠加"本地经验分享"模块——用户在首页选城市 → 搜办事流程 → 看过来人的踩坑经验 → 自己办完可以补充/纠错。商机模块不动。

**Architecture:** 单一 Node.js 后端 (`server.js`) 追加 4 个 API 路由，商机路由不变。前端 `index.html` 变成统一首页（两个入口卡片 + 城市优先搜索），新增 `experience.html` 承载经验列表/详情/发布/补充全流程。数据存 JSON 文件。

**Tech Stack:** Node.js zero-dependency (`node:http`) + vanilla HTML/CSS/JS + JSON file persistence

**Core UX insight:** 本地经验的搜索逻辑跟通用搜索相反——先锚定城市，再输入关键词。因为同一件事在不同城市的流程、材料、窗口完全不同。搜索框设计为：城市选择器 + 关键词输入，一步完成。

---

## Data Model

`data/experiences.json` 是一个数组，每条经验：

```json
{
  "id": "ex_demo_0001",
  "title": "【示例】居住证办理全流程（杭州）",
  "city": "杭州",
  "category": "政务办事",
  "author": "示例用户",
  "createdAt": "2026-07-22T...",
  "updatedAt": "2026-07-22T...",
  "totalDuration": "约7-15个工作日",
  "totalCost": "免费",
  "steps": [
    {
      "title": "线上预约",
      "content": "先在统一平台或小程序上预约，再按预约时段到现场...",
      "duration": "1天",
      "cost": "免费",
      "pitfalls": [
        {"text": "热门窗口号源几分钟内抢完，建议提前填好个人信息", "author": "原文", "addedAt": "2026-07-22T..."}
      ],
      "solutions": [
        {"text": "放号时间不固定时，可以直接到现场取当日号", "author": "示例用户", "addedAt": "2026-07-25T..."}
      ]
    }
  ],
  "supplements": [],
  "tags": ["示例数据", "政务办事", "预约", "材料清单"]
}
```

Catégories 枚举：`车管业务`, `户籍业务`, `社保公积金`, `医疗健康`, `教育入学`, `房产相关`, `营业执照`, `税务相关`, `司法公证`, `其他办事`

---

### Task 1: 创建种子数据 `data/experiences.json`

**Files:**
- Create: `data/experiences.json`

用一条虚构的示例经验作为平台第一条数据（4 个步骤 + 坑位/解法示例）。**不要把任何真实个人信息写进种子数据**——仓库是公开的，真实经历入库前必须脱敏。

### Task 2: 追加 4 个 API 路由到 `src/server.js`

**Files:**
- Modify: `src/server.js`

在现有路由末尾（静态文件服务之前）插入 4 个新路由：

1. `GET /api/experiences` — 列表/搜索。查询参数：`city`, `category`, `q`（关键词搜索标题+标签+步骤内容）
2. `GET /api/experiences/:id` — 单条详情。URL 路径参数 `id`
3. `POST /api/experiences` — 发布经验。必填：`title`, `city`, `category`, `steps`；可选：`author`, `tags`
4. `POST /api/experiences/:id/supplement` — 补充/纠错。必填：`stepIndex` 或 null（null=整体补充）, `type`∈{update,pitfall,solution}, `content`, `author`

数据读写：`loadExperiences()` / `saveExperiences()` 复用现有的原子写模式。

### Task 3: 重写 `src/static/index.html` 为统一首页

**Files:**
- Modify: `src/static/index.html`

新首页结构：
- 顶部：标题"商机嗅探器" + 副标题
- 中间：城市优先搜索框 —— 城市下拉框 + 关键词输入框 + 搜索按钮
- 下方：两个入口卡片 —— "商机广场"（进入 galaxy.html）、"本地经验"（进入 experience.html）—— 也展示最近的几条经验
- 底部：最近更新的经验（3条）

搜索交互：用户选了城市、输入关键词，点击搜索 → 跳转 `experience.html?city=杭州&q=居住证`

保留对 `galaxy.html` 的链接（商机入口）。

### Task 4: 创建 `src/static/experience.html`

**Files:**
- Create: `src/static/experience.html`

一个页面承载四个视图（通过 URL 参数切换）：

1. **列表视图** (`?city=杭州&q=居住证` 或默认 `/experience.html`)：顶部筛选栏（城市 + 分类 + 搜索框），下方经验卡片列表，每张卡片显示标题/城市/分类/步骤数/更新时间。底部"分享我的经验"按钮。

2. **详情视图** (`?id=ex_xxx`)：步骤时间线 + 坑位⚠️标记 + 解决路径🔧标记 + 补充区（按时间倒序展示所有补充）+ "我有补充"和"我有不同经历"按钮。

3. **发布视图** (`?action=publish`)：表单——标题、城市、分类、步骤（动态添加/删除）、标签。每步有名称/描述/耗时/费用/坑位（可选）。

4. **补充弹窗**（在详情页内触发）：选择补充类型（信息更新/新坑位/新解法）、选择对应步骤（或整体）、填写内容。

视觉风格：简洁实用，手机端友好（响应式），坑位用橙色⚠️标记，解决路径用绿色🔧标记。

---

### Task 5: 端到端验证

**验证步骤:**
1. 启动服务器：`node src/server.js`
2. 打开首页：验证搜索框（选城市→输入关键词→搜索）
3. 点击"本地经验"入口 → 进入列表页 → 看到种子数据
4. 点击种子经验 → 进入详情页 → 看到示例步骤 + 坑位标记
5. 在详情页提交一条补充 → 刷新后补充出现在底部
6. 发布一条新经验 → 在列表页能搜到
7. 点击"商机广场" → 进入 galaxy.html（原有功能不受影响）
