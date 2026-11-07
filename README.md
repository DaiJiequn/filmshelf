# 胶卷柜 Film Shelf

个人胶卷库存 / 拍摄 / 冲扫记录 PWA。数据只存在本机浏览器（IndexedDB），可导出 JSON 备份。

## 命令
- `npm install`
- `npm run dev`      开发
- `npm test`         领域逻辑与备份往返测试
- `npm run build`    生成 dist/（PWA，可离线、可添加到主屏幕）

## 上手机
PWA 必须通过 HTTPS 访问才能安装和离线：把 dist/ 整个目录传到 GitHub Pages / Netlify / Cloudflare Pages 即可。
iPhone：Safari 打开 → 分享 → 添加到主屏幕。Android：Chrome 菜单 → 安装应用。
iPhone 上请定期「我的 → 备份与恢复」导出备份。

## 结构
src/db（schema、种子品种、动作、备份）· src/domain（状态机、有效期）· src/motion（动效令牌、招牌动画）· src/pages · src/components
动效实验室：我的 → 设置 → 打开动效实验室。

## 桌面安装包（Electron）
- `npm run pack` 在当前系统上生成安装包到 release/（Mac 出 .dmg，Windows 出 .exe 安装器，Linux 出 .AppImage）。各系统只能打自己的包。
- 没有对应系统时：把源码推到 GitHub，在 Actions 里运行 desktop-installers，三平台安装包会作为 artifact 下载。
- 未做代码签名：Mac 首次打开需右键「打开」；Windows 会出现 SmartScreen 提示，点「仍要运行」。

## 自动更新
安装版（Windows .exe 安装器 / Mac .dmg）内置 electron-updater，启动时检查 GitHub Releases 的新版本。
发布新版：改 package.json 的 version → 提交 → `git tag v1.0.1 && git push --tags`，Actions 会构建并发布到 Release，已安装的用户下次启动自动更新。
需要在 package.json 的 build.publish 里填 GitHub 仓库（provider/owner/repo）。便携 zip 版不支持自动更新。

## 第三方组件与致谢

- 自动除尘引擎：[film-dust](https://github.com/magholmes/film-dust)（MIT），原样收录于 `vendor/film-dust/`，协议见该目录 `LICENSE.txt` / `NOTICES.txt`
- 自动裁切思路：croppy（MIT）；底片转正思路：invers（MIT）、negadoctor / NegPy（仅参考思路，未复制代码）
- TIFF 解码：utif（MIT）；RAW / 哈苏解码：libraw-wasm（ISC，LibRaw 为 LGPL）

## Google Drive 同步设置（一次性）

1. 打开 Google Cloud 控制台，新建项目，启用 **Google Drive API**。
2. 「API 和服务 → OAuth 同意屏幕」：用户类型选外部，填应用名，把自己的 Google 账号加为测试用户。
3. 「凭据 → 创建凭据 → OAuth 客户端 ID」，类型选 **Web 应用**，在「已获授权的 JavaScript 来源」里填应用的网址（如 `https://daijiequn.github.io`）。
4. 把得到的客户端 ID 填到应用「我的 → 备份与恢复 → Google Drive 同步」里。
