# 复现浏览器检查与打包

普通安装只读 [INSTALL.md](../INSTALL.md)，不用这些依赖。

## 隔离测试

测试在独立临时 Chromium 配置中加载扩展，拦截响应模拟 X，覆盖父级事件、虚拟节点回收、作者关系和归集。不读取 X 凭证、不请求真实 X、不改变账号。反馈仅存在测试配置中。

已记录的环境为 Node 24、Playwright 1.62.1 和其 Chromium；其他环境需要自行验证。从仓库根目录运行，例如 PowerShell：

```powershell
npm install --prefix .qa-deps --no-save --package-lock=false playwright@1.62.1
node .qa-deps/node_modules/playwright/cli.js install chromium
$env:PLAYWRIGHT_MODULE = (Resolve-Path '.qa-deps/node_modules/playwright').Path
node qa/parents-bridge.cjs
node qa/run.cjs
```

也可使用已有 Playwright。`PLAYWRIGHT_MODULE` 指向已装模块，`CHROMIUM_EXECUTABLE` 可指定 Chromium，`REPLY_TEST_WORK` 指定独立测试配置的父目录。不要把它指向日常浏览器配置。

测试会重写 `qa-results.json` 和合成截图，合成反馈不是用户标签。600 条压力页记录纯评分、包含归集的处理批次、统一展开和滚动；耗时是本机测量，不代表其他设备。

## 打包

需要 Python 3 标准库，无训练依赖。从仓库根目录运行：

```powershell
python qa/package.py
```

脚本校验当前离线结果，生成安装 ZIP、`test-report.md`、`package-manifest.json`，只打包明确列出的扩展和文档。`live-tray-1.0.3.json` 是保留的历史实机证据，重跑离线脚本不会伪造新实机结果；1.0.4 的界面/模型代码沿用该版本，报告明确分开。

不包含原始训练语料、人工批注、Firefox/Edge 配置、cookies、私有模型中间产物或第三方扩展包。原模型对分记录见 [model-checks.json](../model-checks.json)；没有私有语料就不能完整复现历史训练。

扩展加载方式参考 [Playwright 官方文档](https://playwright.dev/docs/chrome-extensions)。
