# 商机嗅探器 · opportunity-radar

从**信息差第一性原理**出发的行业商机裂变图谱：以一个行业为原点，向外展开变现路径、所需技能和应用场景，帮人发现认知盲区之外的赚钱机会。

> 它是机会发现器，不是信息聚合器。MVP 目前只有种子数据，不构成任何投资建议。

## 当前状态

- 版本：见 `VERSION`（0.3.0）
- 阶段：MVP 原型，主界面升级为 **无界空间商机推演台（Spatial Opportunity Desk）**，并已打通与 [radar](https://github.com/datongcfl/radar) 的实时证据审计桥接
- 结构：
  - **主入口（`/`）**：去边框无限空间卡片画布（`⌘K` 召唤 771 行业词库与归档柜、第一性原理提问式原地裂变、`★ 重点深挖` 与 `✕ 证伪留档`、拖拽建立跨界相通点、4 套 Astryx 语义主题、一键导出 Markdown 行动与待补证据简报）
  - **`radar` 证据矩阵桥接**：卡片直接关联 `radar` 分析包，按模块/子系统查看 `strong / evidence / mention / none` 覆盖度矩阵、已核验原文来源账本与 `gaps.md` 缺口，支持页面内一键重跑 `radar`
  - **本地经验（`/experience.html`）**：独立路由与入口的办事流程避坑模块

## 快速开始

需要 Node.js 18 及以上版本，**零依赖**，不用运行 `npm install`。

```bash
npm run dev
# 浏览器打开 http://localhost:7100
```

可以用环境变量 `PORT` / `HOST` 或参数 `--port` 改端口。

## 功能

- **裂变展开**：点击节点，向外生长出下一层分支
- **互动补充**：访问者可以给已有节点挂上新的门路，补充的节点会标成「待验证」
- **验证标记**：对节点标记「我做了 / 有效 / 无效」，数据实时写回
- **商机卡片**：能赚多少、成本、门槛、周期、第一步、风险

## 目录

```
src/server.js        # node:http 后端，提供 API 和静态资源
src/seed.js          # 种子数据
src/static/          # 前端页面：index（图谱）、galaxy（3D 原型）、experience（经验图谱）
data/                # JSON 数据文件（graph / experiences / meta）
docs/                # 计划文档
DESIGN.md            # 设计文档（API、数据模型、交互）
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/desk` | 读取空间推演台桌面持久化状态 |
| PUT | `/api/desk` | 保存空间推演台节点、连线、跨界桥与主题状态 |
| GET | `/api/radar/packs` | 列出可用的 `radar` 行业证据包与最新覆盖摘要 |
| GET | `/api/radar/runs/:pack` | 获取指定 `radar` 包的模块覆盖度矩阵、来源账本与缺口 |
| POST | `/api/radar/run` | 调用同级 `radar` 引擎实时重算指定分析包的证据覆盖度 |
| POST | `/api/radar/probe` | 一键将画布行业分支翻译为 `pack.json` 并启动首轮 `radar` 搜证探针 |
| POST | `/api/radar/draft-urls` | 从贴入的公开 URL 调用 `radar draft` 自动抓证并重算覆盖度 |
| GET/POST | `/api/radar/claims` | 读写商业主张（客单/获客/合规/履约）并调用 `radar claims` 规则引擎算置信度 |
| GET | `/api/industries` | 行业词库列表（支持 `?all=true` 与 `?q=` 搜索） |
| POST | `/api/industries` | 发起新行业（必须同时填写第一条变现路径） |
| GET | `/api/graph?industry=<id>` | 获取某个行业的可见图谱 |
| POST | `/api/expand` | 展开节点的下一层 |
| POST | `/api/nodes` | 补充节点（必须挂在已有节点下） |
| POST | `/api/marks` | 验证标记 |

详见 [DESIGN.md](DESIGN.md)。

## 合规原则

只采集公开信息；不碰内幕信息；不侵入非公开系统；不提供投资建议。

## 相关项目

- [radar](https://github.com/datongcfl/radar)：行业证据覆盖度检查工具，可以用来核实一个行业方案的证据是否充分

## License

MIT
