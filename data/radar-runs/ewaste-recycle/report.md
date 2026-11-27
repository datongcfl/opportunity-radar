# 电脑与手机电子产品回收（含企业 ITAD） · 雷达运行报告

Run: `20261127-002139` · Pack: `ewaste-recycle` v0.1.0 · Radar: v1.7.0

## 一句话

本次用 10 条来源，覆盖 6 个管理模块 + 4 个子系统；强/证据/提及/空 = 4/6/0/0。

## 平台覆盖

| 平台 | 来源数 |
| --- | ---: |
| github | 5 |
| web | 5 |

## 低星但高覆盖的发现

- 本次没有「低星（≤50）但覆盖 ≥2 格」的来源；这不代表没有低星好资料。

## 访问/许可需要注意

- `EW-001` access=public, license_status=needs_review：GPL-2.0 许可；仅负责硬盘级擦除与报告生成，不含估价、财务与手机端逻辑。
- `EW-002` access=public, license_status=needs_review：专注 x86_64 PC/服务器硬盘离线擦除，不适用于 iOS/Android 移动设备。
- `EW-003` access=public, license_status=needs_review：MPL-2.0 许可；偏底层存储硬件诊断与安全擦除 CLI，需二次封装成收货质检流水线。
- `EW-004` access=public, license_status=needs_review：AGPL-3.0 强传染性开源许可；默认面向企业内部 IT 资产管理，做外部回收商需适配客户分租与计价。
- `EW-005` access=public, license_status=needs_review：LGPL-2.1 许可；提供手机端基础硬件信息采集能力，但不覆盖拆修/进水/扩容等物理暗病检测。
- `EW-008` access=public, license_status=needs_review：宏观环保百科综述，国内执行须直接对照《废弃电器电子产品回收处理管理条例》与危废名录。
- `EW-010` access=public, license_status=needs_review：百科综述文献（CC BY-SA），用于交叉验证数据擦除行业规范，具体涉密要求须查当地法规。
- `EW-011` access=public, license_status=needs_review：百科综述文献（CC BY-SA），不含具体品牌单机实时报价。
- `EW-012` access=public, license_status=proprietary：国际行业认证机构标准（非中国本土环保审批文件，国内拆解仍需《废弃电器电子产品处理资格证书》）。
- `EW-013` access=public, license_status=needs_review：商业平台专有官网，仅作轻资产平台抽佣模式对比参考，需人工复核商业口径。

## 单源模块

- `M03` 资产台账与批次追踪（evidence）
- `M04` 定价毛利与周转风控（evidence）
- `M06` 翻新整备与多渠道出货（evidence）
- `S04` 报废电子垃圾合规拆解（evidence）

## 来源清单

| ID | 标题 | 平台 | 等级 | 许可 | 访问 |
| --- | --- | --- | --- | --- | --- |
| `EW-001` | [martijnvanbrummelen/nwipe](https://github.com/martijnvanbrummelen/nwipe) | github | strong | GPL-2.0（需复核） | public |
| `EW-002` | [PartialVolume/shredos.x86_64](https://github.com/PartialVolume/shredos.x86_64) | github | strong | unknown（需复核） | public |
| `EW-003` | [Seagate/openSeaChest](https://github.com/Seagate/openSeaChest) | github | strong | unknown（需复核） | public |
| `EW-004` | [grokability/snipe-it](https://github.com/grokability/snipe-it) | github | strong | AGPL-3.0（需复核） | public |
| `EW-005` | [libimobiledevice/libimobiledevice](https://github.com/libimobiledevice/libimobiledevice) | github | strong | LGPL-2.1（需复核） | public |
| `EW-008` | [Electronic waste - Wikipedia](https://en.wikipedia.org/wiki/Electronic_waste) | web | evidence | unknown（需复核） | public |
| `EW-010` | [Data erasure - Wikipedia](https://en.wikipedia.org/wiki/Data_erasure) | web | evidence | unknown（需复核） | public |
| `EW-011` | [Refurbishment (electronics) - Wikipedia](https://en.wikipedia.org/wiki/Refurbishment_(electronics)) | web | evidence | unknown（需复核） | public |
| `EW-012` | [R2 - SERI](https://sustainableelectronics.org/r2/) | web | mention | proprietary（不可复用） | public |
| `EW-013` | [About us \| Back Market](https://www.backmarket.com/en-us/about-us) | web | mention | unknown（需复核） | public |

## 边界

- 大多数来源只到 metadata/readme/docs，不等于代码已验证；
- 专有来源只进参考池，不进可复用池；
- 覆盖度不是完整性证明，只是“有没有证据”的导航。
