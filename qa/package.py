"""Package the tested extension without browser profiles, credentials or Git metadata."""
import hashlib,json,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
EXT=ROOT/'extension'
manifest=json.loads((EXT/'manifest.json').read_text(encoding='utf-8'))
q=json.loads((ROOT/'qa-results.json').read_text(encoding='utf-8'))
assert not q.get('failure') and not q['errors']
assert any('root-author replies' in s for s in q['checks'])
assert any('exact folded parents' in s for s in q['checks'])
assert any('one bottom collection' in s for s in q['checks'])
assert any('600-reply stress' in s for s in q['checks'])
assert manifest['permissions']==['storage']
version=manifest['version']
live=json.loads((ROOT/'live-tray-1.0.3.json').read_text(encoding='utf-8'))
assert live['version']==version and not live['extensionErrors']
assert (EXT/'model-data.js').read_text(encoding='utf-8').find('af671420a645e4bbba5a2d39ae1b1fd566d689727bd12f435352ca0ff62acb45')>=0
f=lambda n:f'{n:.2f}'
report=f'''# 留白 {version} 回归记录

日期：2026-11-20。本版改折叠展示和操作逻辑，模型、清洗方法、默认阈值 0.30 与三档取点未修改。

## 行为

原位置不再留逐条提示，命中项集中到当前已加载内容底部。默认只有一行“已收起 N 条回复 · 展开”，一次显示全部、一次收起全部。展开后为连续文字列表，没有逐条展开按钮或卡片边框；各条保留纠错、保留账号及查看原回复链接。图片、视频及原生互动不克隆，点击原回复查看。

原 X 评论节点不搬动。单条虚拟列表容器隐藏后，由 X 重新计算后续条目的位置。已归集文字在节点回收后仍保留，回滚不重复计数，换帖或刷新清空。每帖最多缓存 2,000 个命中项，达到上限后新项保留可见；临时归集不落盘。反馈在本次页面恢复原位置，并继续保存本地“保留”标签，不会自动训练。

父帖作者默认豁免，但回复已折叠内容时一起归到底部。父子关系仅来自 X 已请求的 TweetDetail 响应，不新增请求；只传递 ID，不保存响应正文或凭证。统一展开仅显示底部列表；上级纠错、阈值改变或加入白名单时联动恢复。关系或上级评分未知时保留，不按相邻位置猜。当前帖评分最多缓存 2,000 条、父子 ID 最多缓存 4,000 对。其他账号独立按模型判断。

作者识别依赖当前详情页帖子的账号头部，与父帖正文是否可读无关；没有作者信息时先保留，异步头部到达后重新处理。父帖滚出页面后仍记住作者，切换详情页时清空。引用卡片作者不作为父帖作者。

普通保留项和白名单不插工具条，不加底部占位。反馈记录继续包含折叠原因、上级 ID 和接话自身的分数，兼容旧记录。

## 本版检查

隔离 Chromium {q['environment']['chromium']}，{q['environment']['cpu']}，无真实 X 请求、无账号凭证。共 {len(q['checks'])} 项检查通过，零页面运行错误。

检查包含单一底部入口、一次展开全部、缓存去重、虚拟容器恢复、HTML 文本转义、跳转链接、反馈恢复原位置、白名单、作者及父子关系、换帖清空、鼠标键盘、深浅主题和窄屏。没有替用户填写真实回复标签。qa/parents-bridge.cjs 另检查早到 ID 重放、响应原样返回和消息不含正文或凭证。

| 测量 | 本次结果 |
|---|---:|
| 压力页独立评分文本 | {q['inferenceMs']['n']} 条 |
| 纯模型评分 P95 / 最大 | {f(q['inferenceMs']['p95'])} / {f(q['inferenceMs']['max'])} ms |
| DOM 处理批次 P95 / 最大（每批最多六条） | {f(q['processingBatchMs']['p95'])} / {f(q['processingBatchMs']['max'])} ms |
| 全部评分完成，含导航与工具等待 | {f(q['largePageReadyMs'])} ms |
| 180 帧滚动间隔 P95：有 / 无插件 | {f(q['scroll']['frameMs']['p95'])} / {f(q['withoutExtension']['scroll']['frameMs']['p95'])} ms |
| 一次展开的归集数量 | {q['collectionOpen']['entries']} 条 |
| 全部展开的同步处理 / 等两帧 | {f(q['collectionOpen']['handlerMs'])} / {f(q['collectionOpen']['twoFramesMs'])} ms |
| 展开后 180 帧滚动间隔 P95 | {f(q['collectionOpen']['scroll']['frameMs']['p95'])} ms |

这是一次受控运行，不据此声称速度变化。评分耗时不包括全部 DOM、布局和绘制。原始数据在 qa-results.json。

## 真实 X 与历史证据

本版在隔离 Chromium 中只读检查了一个公开 X 帖子。归集 {live['initial']['hiddenCells']} 条，默认只有一个按钮、零条目行；一次展开显示 {live['opened']['entries']} 条完整已读文字。隐藏容器测量高度全部为 0，可见帖子之间最大空隙 {live['layout']['largestGapPx']} px，原位置插件控件为 0。真实页面自身产生 {len(live['pageErrors'])} 次 UsersByRestIds HTTP 403，原始错误单列于 live-tray-1.0.3.json，不算扩展零错误；未操作用户 Edge，没有修改账号关系。

本版截图为 screenshots/collection-*.png、screenshots/author-parent-folds.png 和 screenshots/live-tray-1.0.3-*.png。live-results.json 及旧 live-desktop.png 等为历史实机证据，replies-*.png 为旧展示方式，不作为本版效果图。模型参数与评分逻辑保持不变；此前分类参考见 thresholds.md。

本地设置、白名单、反馈键名不改，重新加载会继续使用已有数据；没有账号屏蔽入口、没有自动训练或推理联网。

## Git

修改前快照：v1.0.2（0cd04c9）；更早版本亦保留。本版提交后标记 v{version}，回退方法见 CHANGELOG.md。

检查明细：

'''+''.join('- '+s+'\n' for s in q['checks'])
(ROOT/'test-report.md').write_text(report,encoding='utf-8')
files=sorted(p for p in EXT.rglob('*') if p.is_file())+[ROOT/n for n in ['README.md','CHANGELOG.md','thresholds.md','test-report.md']]
archive=ROOT/f'liubai-chrome-edge-v{version}.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in files:z.write(p,p.relative_to(ROOT).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert 'extension/manifest.json' in z.namelist()
    assert all(not n.startswith('/') and '..' not in Path(n).parts for n in z.namelist())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
audit=dict(version=version,archive=archive.name,archive_bytes=archive.stat().st_size,archive_sha256=sha(archive),files=[dict(path=p.relative_to(ROOT).as_posix(),bytes=p.stat().st_size,sha256=sha(p)) for p in files],no_training=True,no_remote_inference=True,no_account_blocking=True,model_source_sha256='af671420a645e4bbba5a2d39ae1b1fd566d689727bd12f435352ca0ff62acb45')
(ROOT/'package-manifest.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in audit.items() if k!='files'}))
