# Cocos 5MB 打包工具

这个目录是 Cocos 可玩广告的本地压缩工具包。

## 直接压缩 HTML

把 Cocos 导出的单文件 HTML 拖到 `compress-html-5mb.bat` 上即可。工具会在原 HTML 所在目录生成：

- `原文件名-5mb.html`
- `原文件名-5mb.zip`
- `原文件名-5mb-landscape.zip`
- `原文件名-5mb-portrait.zip`

原始 HTML 不会被覆盖。

HTML 需要包含 Cocos / super-html 常见的 `window.__zip` 内嵌资源包。如果不是这种格式，工具会提示 `Cannot find window.__zip`。

## 兼容旧入口

也可以继续把 HTML 拖到 `compress-super-html-google-5mb.bat` 上，脚本会自动转到 HTML 压缩入口。

## GIF 序列帧工具

双击 `打开-GIF序列帧工具.bat` 会打开在线工具：

https://mengpingchen954-ops.github.io/merged-asset-tools/#gif

这个快捷入口只是打开在线页面；如果要完全离线集成，需要把网页的 JS/CSS 和依赖一起复制进来。

## 依赖

需要本机安装 Node.js。首次运行 BAT 时会自动在 `tools/cocos-5mb-compressor` 下安装依赖。
