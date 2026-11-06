# MD Reader

轻量本地 Markdown 阅读器（Windows），基于 Tauri 2 + WebView2。

## 功能（一期）

- 打开文件夹 / 文件，左侧懒加载文件树
- GFM 渲染：表格、任务列表、代码高亮、引用、图片
- 亮色 / 暗色 / 跟随系统主题（`Ctrl + J` 切换）
- 外部编辑保存后自动刷新阅读视图
- 记住上次打开的文件夹与文件
- 拖拽文件到窗口直接阅读
- **Markdown 编辑**（v0.2）：`Ctrl+E` 进入编辑，左编辑器 + 右实时预览（可收起）
  - CodeMirror 6：语法高亮、行号、列表自动续行、粗斜体/链接/代码块工具栏
  - `Ctrl+S` 保存 / `Ctrl+Shift+S` 另存为 / `Ctrl+N` 新建；原子写入防损坏
  - mtime 冲突检测：文件被外部修改时弹窗确认，不会互相覆盖
  - 未保存守卫：关窗/切换文件时拦截确认；草稿每 2.5s 暂存，异常退出可恢复
  - 自动保存可选（默认关）
- **系统默认打开方式**：支持命令行参数启动与单实例转发（双击多个文件在窗口内依次切换）
- 安装包自动注册 `.md` / `.markdown` / `.mdown` / `.mkd` 文件关联

## 快捷键

| 按键 | 功能 |
| --- | --- |
| `Ctrl + O` | 打开文件夹 |
| `Ctrl + P` | 打开文件 |
| `Ctrl + J` | 切换主题 |
| `Ctrl + E` | 进入 / 退出编辑 |
| `Ctrl + S` | 保存（编辑模式） |
| `Ctrl + Shift + S` | 另存为（编辑模式） |
| `Ctrl + N` | 新建文件 |

## 开发

```powershell
npm install
npm run dev            # 仅前端（浏览器预览：http://localhost:5173/?demo=1）
npm run tauri dev      # 桌面应用开发模式
```

## 构建安装包

```powershell
scripts\build-release.cmd        # 推荐：自动注入 MSVC/SDK 环境变量后打包
# 或在 Developer PowerShell for VS 中执行：
npm run tauri build
```

产物（已随仓库 `release\` 目录提供）：

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `release\md-reader.exe` | 3.4 MB | 绿色单文件，双击即用 |
| `release\MD Reader_0.2.0_x64-setup.exe` | 1.4 MB | NSIS 安装包（当前用户安装，含 WebView2 引导与文件关联注册） |
| `MD-Reader.html` | 303 KB | 免安装单文件网页版（拖入 `.md` 即可阅读） |

### 设为系统默认打开方式

1. 运行 `MD Reader_0.1.1_x64-setup.exe` 安装（写入 `HKCU\Software\Classes`，无需管理员）。
2. 若此前从未给 `.md` 设置过默认应用：安装后**双击 md 文件即默认用 MD Reader 打开**（已实测）。
3. 若之前选过其他软件为默认：右键 `.md` 文件 → 打开方式 → 选择其他应用 → **MD Reader** → 勾选「始终」；
   或 设置 → 应用 → 默认应用 → 按文件类型选择 `.md`。

> Windows 10/11 不允许安装器静默抢占默认应用（UserChoice 受签名保护），以上一次点击是必需的。

### 单实例行为

- 应用已运行时再次双击文件：不会开新进程，已有窗口置顶并切换到新文档。
- 绿色版 `md-reader.exe` 不注册关联，可用「打开方式」临时指定。

> 注：本机 `vcvars64.bat` 调用异常，故 `scripts\build-release.cmd` 直接注入 MSVC 14.44 / Windows SDK 10.0.26100 环境变量。

## 环境要求

- Node.js 18+
- Rust（`stable-x86_64-pc-windows-msvc`）
- Visual Studio 2022 Build Tools + C++ 工作负载
- WebView2 运行时（Win10 1803+/Win11 通常已自带；安装包会自动引导下载）
