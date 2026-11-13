# 把 Windows 端的 renderer 同步到 Android assets
# renderer 是两端共用的一份源码，仓库里只保留一端，构建 APK 前跑一次本脚本。
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot '..\Windows\renderer'
$dst = Join-Path $PSScriptRoot 'app\src\main\assets\renderer'

if (-not (Test-Path -LiteralPath $src)) {
    throw "找不到渲染层源码：$src"
}

robocopy $src $dst /MIR /NFL /NDL /NJH /NJS
# robocopy 退出码 <8 均为成功（1 表示有文件被复制）
if ($LASTEXITCODE -ge 8) {
    throw "renderer 同步失败，robocopy exit=$LASTEXITCODE"
}

Write-Host "renderer -> $dst 同步完成"
