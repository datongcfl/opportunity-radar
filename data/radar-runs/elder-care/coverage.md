# 覆盖度明细

| 层级 | 数量 |
| --- | ---: |
| none | 0 |
| mention | 0 |
| evidence | 6 |
| strong | 4 |

## 管理模块

### M01 预约受理与智能派单 — evidence

| 来源 | 平台 | 等级 | 许可 | 访问 |
| --- | --- | --- | --- | --- |
| `EC-001` | github | strong | AGPL-3.0 | public |
| `EC-002` | github | strong | unknown | public |
| `EC-003` | github | strong | unknown | public |
| `EC-005` | github | strong | unknown | public |

### M02 陪诊师档案与资质管理 — strong

| 来源 | 平台 | 等级 | 许可 | 访问 |
| --- | --- | --- | --- | --- |
| `EC-004` | github | strong | unknown | public |
| `EC-005` | github | strong | unknown | public |
| `EC-007` | web | mention | unknown | public |
| `EC-009` | web | evidence | unknown | public |

### M03 就诊纪要与用药提醒 — evidence

| 来源 | 平台 | 等级 | 许可 | 访问 |
| --- | --- | --- | --- | --- |
| `EC-001` | github | strong | AGPL-3.0 | public |
| `EC-003` | github | strong | unknown | public |
| `EC-008` | web | mention | unknown | public |

### M04 订单计费与费用分摊 — strong

| 来源 | 平台 | 等级 | 许可 | 访问 |
| --- | --- | --- | --- | --- |
| `EC-001` | github | strong | AGPL-3.0 | public |
| `EC-002` | github | strong | unknown | public |
| `EC-003` | github | strong | unknown | public |
| `EC-005` | github | strong | unknown | public |
| `EC-009` | web | evidence | unknown | public |

### M05 在场打卡留痕与风控 — strong

| 来源 | 平台 | 等级 | 许可 | 访问 |
| --- | --- | --- | --- | --- |
| `EC-004` | github | strong | unknown | public |
| `EC-007` | web | mention | unknown | public |
| `EC-009` | web | evidence | unknown | public |

### M06 服务评价与复购随访 — evidence

| 来源 | 平台 | 等级 | 许可 | 访问 |
| --- | --- | --- | --- | --- |
| `EC-003` | github | strong | unknown | public |
| `EC-007` | web | mention | unknown | public |

## 子系统

- **S01 三甲门诊陪诊与代办** — evidence（1 个来源）
- **S02 居家上门日常照护** — strong（4 个来源）
- **S03 异地家属协同门户** — evidence（3 个来源）
- **S04 机构运营与调度后台** — evidence（1 个来源）

## 同源待印证

这些模块有 ≥2 条证据，但来自同一 host；不能当独立互证。

- `M01` 预约受理与智能派单（独立 host 1）
- `M03` 就诊纪要与用药提醒（独立 host 1）
- `S03` 异地家属协同门户（独立 host 1）
