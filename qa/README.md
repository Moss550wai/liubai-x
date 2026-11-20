# 重跑离线操作与性能检查

这组测试只在独立临时 Chromium 配置中加载扩展，用拦截响应的离线页面模拟 X 的 DOM、虚拟列表、父级 pointerup 导航。**没有 X 凭证，不请求真实 X，不改变任何真实账号。** 合成页面和模拟点击产生的反馈只存在测试配置中，不进入用户数据。

需要 Node、Playwright 和其 Chromium。从本目录运行：

```
node run.cjs
```

若 Playwright 不在通常的模块路径，用环境变量 `PLAYWRIGHT_MODULE` 指向已安装模块；`CHROMIUM_EXECUTABLE` 可指定匹配的 Chromium；`REPLY_TEST_WORK` 可指定独立测试配置的父目录。测试会重写上一级的 `qa-results.json` 与离线截图。真实页面的测试结果另在 `live-results.json`，不会由本脚本伪造。

覆盖：模型接线、原帖与推荐区保护、折叠/展开、独立反馈导出、白名单持久化和并发写入、三档与滑块、暂停与路由切换、不介入账号屏蔽、DOM 复用、链接显示归一化、深浅主题、窄屏、键盘、600 条静态回复的初始化/滚动与纯评分耗时。

测试启动扩展的方式遵循 [Playwright 的 Chromium 扩展文档](https://playwright.dev/docs/chrome-extensions)。普通安装请按上一级 README 操作，不要对日常浏览器配置运行这些测试。
