# 留白 1.0.1 回归记录

日期：2026-11-20。本版改筛选范围和显示逻辑，模型、清洗方法、默认阈值 0.30 与三档取点未修改。

## 行为

父帖作者在评分前豁免。识别依赖当前详情页帖子的账号头部，与父帖正文是否可读无关；没有作者信息时先保留，异步头部到达后重新处理。作者在父帖滚出页面后仍保留，切换详情页时清空。引用卡片作者不作为父帖作者。

模型放行、白名单、父帖作者回复不插入工具条，也不加底部占位；折叠项有展开、纠错、保留账号入口。用户主动展开的命中项保留收起入口，提示文字为“已展开”，不显示“留白”品牌标记。

## 本版检查

隔离 Chromium 148.0.7778.96，11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz，无真实 X 请求、无账号凭证。共 18 项检查通过，零页面运行错误。

检查包含作者大小写、父帖离开 DOM、详情页换作者、纯媒体父帖、延迟账号头部、引用账号排除、正常回复零占位、白名单恢复原样、DOM 复用、鼠标键盘、深浅主题和窄屏。没有替用户填写真实回复标签。

| 测量 | 本次结果 |
|---|---:|
| 压力页独立评分文本 | 604 条 |
| 纯模型评分 P95 / 最大 | 0.20 / 0.70 ms |
| DOM 处理批次 P95 / 最大（每批最多六条） | 4.40 / 6.50 ms |
| 全部评分完成，含导航与工具等待 | 1525.80 ms |
| 180 帧滚动间隔 P95：有 / 无插件 | 16.90 / 16.80 ms |

这是一次受控运行，不据此声称速度变化。评分耗时不包括全部 DOM、布局和绘制。原始数据在 qa-results.json。

## 历史证据与边界

live-results.json 和 screenshots/live-*.png 属于 1.0.0 的实机记录，本版没有新做真实 Edge/X 页面操作，不把旧数据当本版验收。用户已有 Edge 实测的问题由本版规则及回归场景覆盖，加载后仍需观察实际页面。模型参数与评分逻辑保持不变；此前标签和分类参考指标见 thresholds.md。

本地设置、白名单、反馈键名不改，重新加载会继续使用已有数据；没有账号屏蔽入口、没有自动训练或推理联网。

## Git

修改前快照：v1.0.0（5ed4ca1）。本版提交后标记 v1.0.1，回退方法见 CHANGELOG.md。

检查明细：

- default aggressive, text-only scope, root/ancestors/quotes/ads/media/recommendations preserved
- root-author replies and normal replies keep native markup without badges or toolbar spacing
- root author survives virtualization and is reset when the detail route changes
- missing root text, quoted authors and delayed root headers cannot fold the original author
- one-click expand and refold retain original content
- X replacing article classes cannot drop the fold state or toolbar spacing
- recommendations stay unfiltered after their heading is removed by virtualization
- normal flex replies have no extra spacing; expanded folds keep controls below native content
- feedback saved locally once, expands reply, export JSON includes text and explicit keep label
- one-click whitelist overrides model and persists across reload; removal restores filtering
- popup presets, slider, validation and normalized handles
- concurrent local writes serialize without losing accounts; invalid settings are rejected
- disabled restores originals, enabled resumes, home/search routes untouched
- virtualized article recycling does not leak author, fold state or feedback target
- display-shortened URLs normalize using their actual link, without storing changed reply text
- light/dark popup and narrow reply layout have no horizontal overflow; keyboard works
- plugin has no account block button or automatic X account action
- no runtime errors or extension-created remote service calls in offline fixtures
