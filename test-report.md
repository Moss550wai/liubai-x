# 留白 v1：功能与性能实测

日期：2026-11-20。模型固定，默认激进阈值 0.30；没有训练、上下文模型、账号聚合或自动账号操作。本版不提供屏蔽按钮，屏蔽完全由用户在 X 内手动完成。

## 交互与安装

15 项离线检查通过，零运行错误。覆盖展开与再次收起、鼠标及键盘、白名单持久化、表单验证、并发写入、三档与滑块、反馈导出、暂停恢复、SPA 路由、DOM 复用、引用排除、推荐边界、链接归一化、主题切换与 390px 窄屏。主面板宽 368px、高不超过 600px，名单区独立滚动。

原帖、上级帖子、广告、纯媒体和已识别的推荐原帖保持原样；无法确定来源的条目也保留。真实 X 上验证了工具条位于正文下方，不压缩正文。鼠标按下不会因焦点处理移动按钮，键盘仍可正常操作。

## 测量环境与范围

Windows，11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz，8 逻辑 CPU；Chromium 148.0.7778.96，1280×900，独立配置、无浏览器用户扩展。推理为纯 JavaScript CPU，无 WASM、WebGPU、远程接口或外部运行库。Chrome/Edge 的正常配置没有被修改；Edge 二进制未单独实测。

离线页含 600 条额外回复，共处理 604 条文字回复。是可重复的 DOM/操作压力测试，不是分类效果验收，也不是实时 X 加载速度的替代。

| 项目 | 实测 |
|---|---:|
| 604 条回复的纯模型评分 P50 / P95 / 最大 | 0.00 / 0.20 / 1.20 ms |
| DOM 处理批次 P95 / 最大（每批最多 6 条） | 4.20 / 4.80 ms |
| 内容脚本开始到首批控件就绪 | 13.00 ms |
| 导航开始到全部 604 条处理完（含测试工具等待） | 1647.60 ms |
| 有扩展：DOMContentLoaded / load | 53.30 / 233.60 ms |
| 无扩展：DOMContentLoaded / load | 61.80 / 87.20 ms |
| 连续 180 帧滚动 P95：有 / 无扩展 | 17.00 / 16.80 ms |
| 滚动时观察到的 >50ms 长任务：有 / 无扩展 | 0 / 0 |
| 初始化时观察到的 >50ms 长任务：有 / 无扩展 | 1 / 1 |

这些是一次受控浏览器运行，不据此声称页面变快。初始化长任务包含 HTML 解析、首次布局等整页工作，不能直接归因于模型；原始持续时间保存在 JSON。评分耗时不等于完整显示延迟，DOM、布局、绘制和页面自身任务另占时间。浏览器计时有量化，0.00ms 不代表零计算。

长文本也做了独立评分压力测试：

| 字符数 | 40 次评分的 P95 |
|---|---:|
| 16 | 0.10 ms |
| 64 | 0.10 ms |
| 256 | 0.50 ms |
| 1024 | 1.10 ms |
| 4096 | 3.60 ms |
| 12000 | 11.40 ms |

插件对超过 12,000 字的可见回复保留原文。其他硬件和更复杂页面可能更慢。

## 真实 X 页面

三条已知公开技术帖，正常加载及滚动；仅使用用户授权的隔离登录态。账号凭证不进入交付。白名单交互在隔离配置中临时加入再移除，用于操作检查，没有写入日常浏览器，也没有生成真实回复的人工作业标签。

| 页面 | 当前加载 article | 可处理回复 | 默认折叠 | 原帖 | 滚动帧间隔 P95 |
|---|---:|---:|---:|---|---:|
| [原帖 1](https://x.com/lanshu/status/2122152027790926194) | 18 | 17 | 7 | 保留 | 16.80 ms |
| [原帖 2](https://x.com/bkdgiffug/status/2120835496846770534) | 11 | 8 | 7 | 保留 | 16.90 ms |
| [原帖 3](https://x.com/laopai1990/status/2119250494027976779) | 20 | 16 | 7 | 保留 | 16.80 ms |

实际处理 41 条，其中折叠 21 条。这是界面动作记录，不是正确率判断。滚动期间可取得计数的 3 页评分 48 次，P95 0.30ms，最大 0.70ms；处理批次 P95 4.00ms，最大 17.80ms。三页计数均已取得。滚动会追加加载回复，所以评分次数与初始条数不同。真实页面会加载图片、视频、广告并虚拟化列表，帧间隔包含这些工作，不承诺整页始终 60fps。

捕获的账号屏蔽/解除请求数为 0；插件代码也不存在相关菜单查找或点击逻辑。没有实际屏蔽任何账号。X 自带菜单仍由用户手动操作。

## 模型、数据与限制

浏览器参数导自固定模型，SHA-256：`af671420a645e4bbba5a2d39ae1b1fd566d689727bd12f435352ca0ff62acb45`。321 条文本核对中，分数最大绝对差 1.18168210772e-08，低于 1e-6。没有重新训练，既有用户标签和验收候选不改动。

设置、白名单和反馈只存当前配置的 chrome.storage.local，没有云同步。只有点击「不该折叠」才保存反馈；不自动重训。ZIP 中只包含可运行扩展和用户说明，不含浏览器配置、账号凭证、训练依赖或测试反馈。

尚未在日常 Chrome/Edge 配置安装、尚未进行一周使用；Edge 需用户加载后观察兼容性。X 改版、关键文字未展开、媒体内容、未知推荐区结构会影响覆盖范围。默认激进仍会误伤和漏放，具体取舍见 [thresholds.md](thresholds.md)。

检查项：

- default aggressive, text-only scope, root/ancestors/quotes/ads/media/recommendations preserved
- one-click expand and refold retain original content
- X replacing article classes cannot drop the fold state or toolbar spacing
- recommendations stay unfiltered after their heading is removed by virtualization
- toolbar stays below native content even when the article is a horizontal flex container
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

技术依据：[Chrome 本地存储](https://developer.chrome.com/docs/extensions/reference/api/storage)、[Playwright 的 Chromium 扩展测试说明](https://playwright.dev/docs/chrome-extensions)。原始数据在 qa-results.json、live-results.json、model-checks.json，截图在 screenshots/。
