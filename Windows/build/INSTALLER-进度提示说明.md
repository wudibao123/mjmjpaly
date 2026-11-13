# 安装器“正在解压 / 正在干嘛”进度提示（构建说明）

## 用户要求
EXE 安装过程中要显示当前正在做什么，例如“正在解压 xxx”“正在注册命令行…”，而不是只有一个无声的进度条。

## 为什么改到了 node_modules
electron-builder 的 NSIS 模板把安装页详情区强制隐藏了，而这个模板不受项目配置控制：

- `node_modules/app-builder-lib/templates/nsis/common.nsh` 第 5 行原为 `ShowInstDetails nevershow`
- `node_modules/app-builder-lib/templates/nsis/installSection.nsh` 原为 `SetDetailsPrint none`

`nsis.include`（本项目为 `build/installer.nsh`）会被插到 `installer.nsi` **之前**，页面宏在这些模板之后定义，所以在项目侧写 `ShowInstDetails show` 会被模板覆盖，不起作用。

## 实际改动
1. `common.nsh`：`ShowInstDetails nevershow` → `ShowInstDetails show`（详情区常显）
2. `installSection.nsh`：`SetDetailsPrint none` → `SetDetailsPrint both`（每步 DetailPrint 同时进详情区和状态栏）
3. `build/installer.nsh`：`customInstall` / `customUnInstall` 里补充中文步骤文案（写入注册表信息、注册 mjplay 到用户 PATH、创建快捷方式、收尾）
4. `package.json` 的 `build.nsis.installerLanguages` 设为 `["zh_CN"]`，安装器界面全中文，解压阶段显示 NSIS 自带的“正在解压: 文件名”

## 复原方式
两个原先的模板已备份为同目录下的：

- `common.nsh.mjmjbak`
- `installSection.nsh.mjmjbak`

`npm install` / 重装 electron-builder 后，这两个模板会回到默认（隐藏详情），需要重新应用上面第 1、2 步。

## 生效方式
模板是每次构建 NSIS 时读取的，重新执行打包（完整打包或 `--prepackaged release\win-unpacked` 重打）即生效，不需要重装依赖。
