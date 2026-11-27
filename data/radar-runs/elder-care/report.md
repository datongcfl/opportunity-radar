# 银发陪诊与居家照护服务 · 雷达运行报告

Run: `20261126-233757` · Pack: `elder-care` v0.1.0 · Radar: v1.7.0

## 一句话

本次用 8 条来源，覆盖 6 个管理模块 + 4 个子系统；强/证据/提及/空 = 4/6/0/0。

## 平台覆盖

| 平台 | 来源数 |
| --- | ---: |
| github | 5 |
| web | 3 |

## 低星但高覆盖的发现

- `EC-001` [NexaFlowFrance/OpenCare](https://github.com/NexaFlowFrance/OpenCare) — 9★，覆盖 4 格，开源自托管家庭老年照护协同应用（共享就诊日历、照护日志、用药提醒与照护者分摊账单）
- `EC-003` [Gray878/wx_clinic](https://github.com/Gray878/wx_clinic) — 16★，覆盖 4 格，微信云开发医疗陪诊小程序（覆盖三甲医院展示、小时陪诊、取送报告、代办取药、退款与评价）
- `EC-004` [NabsCodes/ecms](https://github.com/NabsCodes/ecms) — 5★，覆盖 4 格，React + Express 老年照护管理系统（老人健康偏好档案、按技能与排班匹配护工、安全沟通）
- `EC-005` [techrivers/Homecare-Scheduling-Platform](https://github.com/techrivers/Homecare-Scheduling-Platform) — 1★，覆盖 4 格，CommandCare 四角色居家照护调度平台（智能排班负荷优化、护工专科管理、账单追踪与管理看板）

## 访问/许可需要注意

- `EC-001` access=public, license_status=needs_review：AGPL-3.0 强传染性开源许可；偏家庭照护圈协同，不含商业平台抢单与微信支付。
- `EC-002` access=public, license_status=needs_review：教学与脚手架性质前端代码，未声明开源许可证，需自建后端派单与风控校验。
- `EC-003` access=public, license_status=needs_review：未显式附带开源许可证文件；默认含本地体验数据，生产部署需独立鉴权与隐私合规改造。
- `EC-004` access=public, license_status=needs_review：单机构原型级 Web 系统，不含移动端 GPS 电子打卡与国内医保/长护险结算。
- `EC-005` access=public, license_status=needs_review：全英文角色管理后台，缺少国内三甲门诊挂号取号流程细节。
- `EC-007` access=public, license_status=needs_review：英国公共医疗与社会照护制度背景，收费补贴标准与国内自费陪诊市场不同。
- `EC-008` access=public, license_status=needs_review：宏观公共卫生权威指南，非具体软件工程实现。
- `EC-009` access=public, license_status=needs_review：百科综述文献（CC BY-SA），仅作职责分类与正负面边界参考，不可替代地方法规。

## 单源模块

- `M06` 服务评价与复购随访（evidence）
- `S01` 三甲门诊陪诊与代办（evidence）
- `S04` 机构运营与调度后台（evidence）

## 来源清单

| ID | 标题 | 平台 | 等级 | 许可 | 访问 |
| --- | --- | --- | --- | --- | --- |
| `EC-001` | [NexaFlowFrance/OpenCare](https://github.com/NexaFlowFrance/OpenCare) | github | strong | AGPL-3.0（需复核） | public |
| `EC-002` | [HSg666/peizhengproject](https://github.com/HSg666/peizhengproject) | github | strong | unknown（需复核） | public |
| `EC-003` | [Gray878/wx_clinic](https://github.com/Gray878/wx_clinic) | github | strong | unknown（需复核） | public |
| `EC-004` | [NabsCodes/ecms](https://github.com/NabsCodes/ecms) | github | strong | unknown（需复核） | public |
| `EC-005` | [techrivers/Homecare-Scheduling-Platform](https://github.com/techrivers/Homecare-Scheduling-Platform) | github | strong | unknown（需复核） | public |
| `EC-007` | [Help at home from a paid carer - Social care and support guide - NHS](https://www.nhs.uk/social-care-and-support/care-services-equipment-and-care-homes/homecare/) | web | mention | unknown（需复核） | public |
| `EC-008` | [Ageing and health](https://www.who.int/news-room/fact-sheets/detail/ageing-and-health) | web | mention | unknown（需复核） | public |
| `EC-009` | [Home care - Wikipedia](https://en.wikipedia.org/wiki/Home_care) | web | evidence | unknown（需复核） | public |

## 边界

- 大多数来源只到 metadata/readme/docs，不等于代码已验证；
- 专有来源只进参考池，不进可复用池；
- 覆盖度不是完整性证明，只是“有没有证据”的导航。
