# 等待 MSVC 链接器就绪后自动执行 Tauri 打包
$ErrorActionPreference = "Continue"
$project = "c:/Users/Administrator/CodeBuddy/20261103133647"
$log = Join-Path $project "build.log"
$msvcRoot = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"

"=== watcher started $(Get-Date -Format 'HH:mm:ss') ===" | Set-Content $log

$deadline = (Get-Date).AddHours(2)
while ((Get-Date) -lt $deadline) {
    $link = Get-ChildItem $msvcRoot -Recurse -Filter link.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*Hostx64\x64*" } |
        Select-Object -First 1
    if ($link) {
        "linker found: $($link.FullName)" | Add-Content $log
        break
    }
    Start-Sleep -Seconds 20
}

if (-not $link) {
    "timeout waiting for linker" | Add-Content $log
    exit 1
}

# 等待安装器收尾（SDK 可能仍在释放）
Start-Sleep -Seconds 20

Set-Location $project
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
"=== npm run tauri build $(Get-Date -Format 'HH:mm:ss') ===" | Add-Content $log
npm run tauri build *>&1 | Add-Content $log
"=== exit code $LASTEXITCODE $(Get-Date -Format 'HH:mm:ss') ===" | Add-Content $log
