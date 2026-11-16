# 发布 GitHub Release（使用 Git 凭据管理器中的令牌，不打印令牌本身）
# 用法: powershell -ExecutionPolicy Bypass -File scripts\publish-release.ps1 -Version 0.4.1 -Title "v0.4.1 · 修复窗口无法关闭"
param(
  [string]$Version = "0.4.1",
  [string]$Title = "v0.4.1 · 修复窗口无法关闭"
)
$ErrorActionPreference = "Stop"

$repo = "mobTaotao/easy-doc-reader"
$tag = "v$Version"
$root = Split-Path $PSScriptRoot -Parent

# 1) 从 Git 凭据管理器取令牌（LF 临时文件 + 重定向，避免 CRLF/引号干扰）
$credInputFile = Join-Path $env:TEMP "cred-in.txt"
[System.IO.File]::WriteAllText($credInputFile, "protocol=https`nhost=github.com`n", (New-Object System.Text.UTF8Encoding $false))
$credOutput = cmd /c "git credential fill < `"$credInputFile`""
Remove-Item $credInputFile -Force

$map = @{}
foreach ($line in $credOutput) {
  $i = $line.IndexOf("=")
  if ($i -gt 0) { $map[$line.Substring(0, $i)] = $line.Substring($i + 1) }
}
$token = $map["password"]
if (-not $token) { throw "未找到 GitHub 凭据，请先 git push 一次或手动 gh auth login" }
"凭据用户: $($map['username']) (token 长度 $($token.Length))"

$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}

# 2) 若 Release 已存在则复用
$existing = $null
try { $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers } catch {}
if ($existing) {
  $release = $existing
  "复用已有 Release: $($release.html_url)"
} else {
  $notes = @"
## 更新内容

### 修复
- **窗口无法关闭**：v0.4.0 引入的回归。前端注册关闭监听后关闭动作改由 \`window.destroy()\` 执行，但 Tauri 权限未包含 \`core:window:allow-destroy\`，调用被拒 → 关不掉。本版已补权限，并加固关闭流程（保存异常也必定退出）

### 既有功能
- Markdown 编辑（Ctrl+E 双模式 + 实时预览）、原子保存 + 冲突检测、草稿恢复、自动保存（可选）
- JSON：默认美化高亮展示（可切原文/复制）、编辑 + 美化/压缩、保存前校验
- TXT：纯文本阅读（不按 Markdown 解析）与编辑
- 侧栏右键：重命名 / 删除 / 新建（md/txt/json）
- .md 文件关联、命令行启动、单实例转发

## 下载

| 文件 | 说明 |
| --- | --- |
| \`MD-Reader_${Version}_x64-setup.exe\` | 安装包（推荐，自动注册 .md 关联） |
| \`md-reader.exe\` | 绿色单文件，无需安装 |
| \`MD-Reader.html\` | 免安装网页版，浏览器直接打开 |
"@
  $payload = @{
    tag_name         = $tag
    target_commitish = "main"
    name             = $Title
    body             = $notes
    draft            = $false
    prerelease       = $false
  } | ConvertTo-Json -Depth 4
  $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers `
    -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
  "创建 Release: $($release.html_url)"
}

# 3) 上传资产（安装包取 release 目录中最新的，文件名空格转连字符）
$setup = Get-ChildItem (Join-Path $root "release") -Filter "*_x64-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$uploads = @(
  @{ path = $setup.FullName; name = ($setup.Name -replace " ", "-") },
  @{ path = (Join-Path $root "release\md-reader.exe"); name = "md-reader.exe" },
  @{ path = (Join-Path $root "MD-Reader.html"); name = "MD-Reader.html" }
)

foreach ($item in $uploads) {
  if (-not (Test-Path $item.path)) { "跳过（缺失）: $($item.path)"; continue }
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$($release.id)" -Headers $headers
  if ($release.assets | Where-Object { $_.name -eq $item.name }) { "跳过（已存在）: $($item.name)"; continue }

  $bytes = [System.IO.File]::ReadAllBytes($item.path)
  $uri = "https://uploads.github.com/repos/$repo/releases/$($release.id)/assets?name=$($item.name)"
  $uploaded = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType "application/octet-stream" -Body $bytes
  "已上传: $($uploaded.name) ($([math]::Round($uploaded.size/1MB,2)) MB)"
}

"---"
"完成。Release 页面: https://github.com/$repo/releases/tag/$tag"
