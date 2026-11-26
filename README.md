# 商机嗅探器 · opportunity-radar

从**信息差第一性原理**出发的行业商机裂变图谱：以一个行业为原点，向外展开变现路径、所需技能和应用场景，帮人发现认知盲区之外的赚钱机会。

> 它是机会发现器，不是信息聚合器。MVP 目前只有种子数据，不构成任何投资建议。

## 当前状态

- 版本：见 `VERSION`（0.3.0）
- 阶段：MVP 原型，首发行业是「AI 行业」
- 结构：**广场层**（行业列表）+ **行业层**（单个行业的裂变图谱），另有 3D 星系原型页和本地经验图谱页

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
| GET | `/api/industries` | 行业列表 |
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
