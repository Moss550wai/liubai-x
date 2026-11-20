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
assert manifest['permissions']==['storage']
version=manifest['version']
assert (EXT/'model-data.js').read_text(encoding='utf-8').find('af671420a645e4bbba5a2d39ae1b1fd566d689727bd12f435352ca0ff62acb45')>=0
f=lambda n:f'{n:.2f}'
report=f'''# 留白 {version} 回归记录

日期：2026-11-20。本版改筛选范围和显示逻辑，模型、清洗方法、默认阈值 0.30 与三档取点未修改。

## 行为

父帖作者默认豁免，但回复了已折叠内容时随上级收起。父子关系仅来自 X 已请求的 TweetDetail 响应，不新增请求；只跨页面脚本边界传递 ID，不保存响应正文或凭证。上级展开、阈值改变或加入白名单时联动恢复；作者接话也能单独展开。关系或上级评分未知时保留，不按相邻位置猜。当前帖评分最多缓存 2,000 条、父子 ID 最多缓存 4,000 对。普通其他账号继续独立按模型判断。

作者识别依赖当前详情页帖子的账号头部，与父帖正文是否可读无关；没有作者信息时先保留，异步头部到达后重新处理。父帖滚出页面后仍记住作者，切换详情页时清空。引用卡片作者不作为父帖作者。

普通保留项和白名单不插入工具条，也不加底部占位；模型命中及随上级收起项有展开、纠错、保留账号入口。用户主动展开的命中项保留收起入口，提示文字为“已展开”，不显示“留白”品牌标记。反馈增加折叠原因和上级 ID，保留接话自身的分数，兼容旧记录。

## 本版检查

隔离 Chromium {q['environment']['chromium']}，{q['environment']['cpu']}，无真实 X 请求、无账号凭证。共 {len(q['checks'])} 项检查通过，零页面运行错误。

检查包含早到响应、fetch/XHR 父子关系、连续作者接话、展开及阈值联动、白名单覆盖、上级离开 DOM、换帖重建、未知及非法关系保留，以及作者大小写、纯媒体父帖、延迟账号头部、引用账号排除、正常回复零占位、DOM 复用、鼠标键盘、深浅主题和窄屏。没有替用户填写真实回复标签。另有 qa/parents-bridge.cjs 检查早到 ID 的重放、响应原样返回和跨页面消息不含正文或凭证。

| 测量 | 本次结果 |
|---|---:|
| 压力页独立评分文本 | {q['inferenceMs']['n']} 条 |
| 纯模型评分 P95 / 最大 | {f(q['inferenceMs']['p95'])} / {f(q['inferenceMs']['max'])} ms |
| DOM 处理批次 P95 / 最大（每批最多六条） | {f(q['processingBatchMs']['p95'])} / {f(q['processingBatchMs']['max'])} ms |
| 全部评分完成，含导航与工具等待 | {f(q['largePageReadyMs'])} ms |
| 180 帧滚动间隔 P95：有 / 无插件 | {f(q['scroll']['frameMs']['p95'])} / {f(q['withoutExtension']['scroll']['frameMs']['p95'])} ms |

这是一次受控运行，不据此声称速度变化。评分耗时不包括全部 DOM、布局和绘制。原始数据在 qa-results.json。

## 历史证据与边界

live-results.json 和 screenshots/live-*.png 属于 1.0.0 的实机记录，本版没有新做真实 Edge/X 页面操作，不把旧数据当本版验收。用户已有 Edge 实测的问题由本版规则及回归场景覆盖，加载后仍需观察实际页面。模型参数与评分逻辑保持不变；此前标签和分类参考指标见 thresholds.md。

本地设置、白名单、反馈键名不改，重新加载会继续使用已有数据；没有账号屏蔽入口、没有自动训练或推理联网。

## Git

修改前快照：v1.0.1（6471b09）；更早版本 v1.0.0（5ed4ca1）亦保留。本版提交后标记 v{version}，回退方法见 CHANGELOG.md。

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
