# 商店提交材料

准备日期：2026-11-20。此目录记录提交准备，**不表示已通过审核或已上线**。实际状态以开发者后台为准。

- `liubai-store-v1.0.4.zip`：商店上传包，manifest.json 在 ZIP 根目录，只含 extension 的运行文件。不要上传手动安装版的外层文档包。
- `listing.json`、`LISTING.zh-CN.txt`：标题、说明、单一用途、权限及数据处理解释。
- `edge/PRIVACY.md` / `chrome/PRIVACY.md`：对应浏览器的公开隐私声明。
- `assets/`：1280×800 截图、300×300 logo、440×280 小推广图。截图为带标记的合成示例，展示实际扩展界面，不代表准确率。
- `REVIEWER-NOTES.txt`：审核人员操作说明；不提供用户凭证。

后端声明须准确披露本地数据处理：网站内容、作者用户名、当前帖子/回复链接；不能笼统写成“不访问/不处理任何用户数据”。`storage` 只存本地设置、白名单和主动纠错，不联网训练或同步。

开发者账号、主体/联系信息、开发者协议和必要身份验证由账号所有人完成。Chrome 开发者账号有一次性注册费，Edge 项目当前无注册费；金额和条件以后台为准。未填写虚构主体或邮箱。

上架后商店版与当前解压安装版可能是不同扩展身份，本地白名单/反馈不会自动迁移；安装商店版前先导出旧版反馈。当前只有导出，没有导入功能。

官方依据（2026-11-20 核对）：

- [Edge 注册](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)
- [Edge 发布与素材尺寸](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Chrome 注册](https://developer.chrome.com/docs/webstore/register)
- [Chrome 本地数据也须披露](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
