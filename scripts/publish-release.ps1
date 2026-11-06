# 发布 GitHub Release（使用 Git 凭据管理器中的令牌，不打印令牌本身）
$ErrorActionPreference = "Stop"

$repo = "mobTaotao/easy-doc-reader"
$tag = "v0.4.0"

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
$username = $map["username"]
"凭据用户: $username (token 已取得，长度 $($token.Length))"

$headers = @{
  Authorization   = "Bearer $token"
  Accept          = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}

# 2) 若 Release 已存在则复用
$existing = $null
try { $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers } catch {}
if ($existing) {
  $release = $existing
  "复用已有 Release: $($release.html_url)"
} else {
  $body = @{
    tag_name         = $tag
    target_commitish = "main"
    name             = "v0.4.0 · 编辑模式 + JSON/TXT 支持"
    body             = @"
## 更新内容

- **Markdown 编辑模式**：Ctrl+E 进入，CodeMirror 6 编辑器 + 实时预览，Ctrl+S 保存 / Ctrl+Shift+S 另存 / Ctrl+N 新建
- **JSON 支持**：默认美化高亮展示（可切原文/复制），编辑模式"美化/压缩"按钮，保存前校验
- **TXT 支持**：纯文本阅读（不按 Markdown 解析）与编辑
- **文件管理**：侧栏右键 重命名 / 删除 / 新建文件（md/txt/json，创建后直接改名）
- **系统集成**：.md 文件关联、命令行启动、单实例转发；原子写入 + 冲突检测 + 草稿恢复
- 亮暗主题、自动保存（可选）、外部修改自动刷新

## 下载

| 文件 | 说明 |
| --- | --- |
| ``MD-Reader_0.4.0_x64-setup.exe`` | 安装包（推荐，自动注册 .md 关联） |
| ``md-reader.exe`` | 绿色单文件，无需安装 |
| ``MD-Reader.html`` | 免安装网页版，浏览器直接打开 |

安装后双击 .md 即可用 MD Reader 打开（若之前设置过其他默认应用，需在"打开方式"中选择一次）。
"@
    draft     = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 4
  $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
  "创建 Release: $($release.html_url)"
}

# 3) 上传资产
$uploads = @(
  @{ path = Join-Path $PSScriptRoot "..\release\MD Reader_0.4.0_x64-setup.exe"; name = "MD-Reader_0.4.0_x64-setup.exe" },
  @{ path = Join-Path $PSScriptRoot "..\release\md-reader.exe"; name = "md-reader.exe" },
  @{ path = Join-Path $PSScriptRoot "..\MD-Reader.html"; name = "MD-Reader.html" }
)

foreach ($item in $uploads) {
  $path = Resolve-Path $item.path
  $size = (Get-Item $path).Length
  if ($size -gt 2GB) { throw "文件超过 2GB 限制: $path" }

  # 已上传则跳过
  $already = $release.assets | Where-Object { $_.name -eq $item.name }
  if ($already) { "跳过（已存在）: $($item.name)"; continue }

  $bytes = [System.IO.File]::ReadAllBytes($path)
  $uri = "https://uploads.github.com/repos/$repo/releases/$($release.id)/assets?name=$($item.name)"
  $uploaded = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType "application/octet-stream" -Body $bytes
  "已上传: $($uploaded.name) ($([math]::Round($uploaded.size/1MB,2)) MB)"
}

"---"
"完成。Release 页面: $($release.html_url)"
