# MJMJ 命令行播放器（mjplay）
# 参数一律英文，说明为中文；不依赖 Node，只用系统自带 PowerShell。
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$SearchPort = 31999
$ControlPort = 31997
$CacheDir = Join-Path $env:APPDATA 'MJMJ'
$CacheFile = Join-Path $CacheDir 'cli-last.json'

function Show-Help {
  Write-Host ''
  Write-Host 'mjplay —— MJMJ 命令行点歌（客户端需已启动）'
  Write-Host ''
  Write-Host '用法：'
  Write-Host '  mjplay                 打开菜单：1 随机播放 / 2 搜索'
  Write-Host '  mjplay <歌名> [歌手]   搜索并列出结果，然后输入序号播放（带歌手=精准匹配）'
  Write-Host '  mjplay -s <歌名> [歌手] 只搜索，打印：序号 歌名 歌手 专辑 版权标记 ID'
  Write-Host '  mjplay -p <序号>       播放上一次搜索结果里的第 N 首'
  Write-Host '  mjplay -k <歌曲ID>     按歌曲 ID 直接播放'
  Write-Host '  mjplay -h              显示本帮助'
  Write-Host ''
  Write-Host '示例：'
  Write-Host '  mjplay'
  Write-Host '  mjplay 晴天 周杰伦'
  Write-Host '  mjplay -s 前天'
  Write-Host '  mjplay -p 1'
  Write-Host '  mjplay -k 347230'
  Write-Host ''
}

function Test-Client {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$ControlPort/ping" -TimeoutSec 3
    if ($r.ok) { return $true }
  } catch { }
  return $false
}

function Get-FeeTag($s) {
  $fee = 0
  if ($null -ne $s.fee) { $fee = [int]$s.fee }
  elseif ($s.privilege -and $null -ne $s.privilege.fee) { $fee = [int]$s.privilege.fee }
  switch ($fee) {
    1 { return 'VIP' }
    4 { return '付费专辑' }
    8 { return 'VIP试听' }
    default { return '免费' }
  }
}

function Convert-Track($s) {
  $artist = ''
  if ($s.ar) { $artist = (@($s.ar) | ForEach-Object { $_.name }) -join ' / ' }
  return [pscustomobject]@{
    id       = [string]$s.id
    name     = [string]$s.name
    artists  = $artist
    album    = [string]($s.al.name)
    pic      = [string]($s.al.picUrl)
    duration = [int64]($s.dt)
    feeTag   = (Get-FeeTag $s)
  }
}

function Read-Input([string]$prompt) {
  if ([Console]::IsInputRedirected) {
    $l = [Console]::In.ReadLine()
    return $l
  }
  return (Read-Host $prompt)
}

function Split-Query([string]$q) {
  $q = ($q -replace '\s+', ' ').Trim()
  $parts = $q -split ' '
  $name = $parts[0]
  $artist = ''
  if ($parts.Count -gt 1) { $artist = ($parts[1..($parts.Count - 1)] -join ' ') }
  return @{ name = $name; artist = $artist }
}

function Search-Songs([string]$kw, [string]$artist) {
  $u = "http://127.0.0.1:$SearchPort/api/cloudsearch?keywords=" + [uri]::EscapeDataString($kw) + "&limit=20"
  $r = Invoke-RestMethod -Uri $u -TimeoutSec 20
  $out = @()
  if ($r.result -and $r.result.songs) {
    foreach ($s in $r.result.songs) { $out += (Convert-Track $s) }
  }
  # 歌名 + 歌手：按歌手做精准过滤（过滤不到就退回全部结果）
  if ($artist) {
    $hit = @($out | Where-Object { $_.artists -like ("*" + $artist + "*") })
    if ($hit.Count -gt 0) { $out = $hit }
  }
  return @($out | Select-Object -First 10)
}

function Play-Random {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$SearchPort/api/personalized/newsong?limit=20" -TimeoutSec 20
    $list = @($r.result)
    if ($list.Count -eq 0) { Write-Host '没取到推荐歌单，试试 mjplay -s 歌名' -ForegroundColor Yellow; exit 1 }
    $pick = $list[(Get-Random -Maximum $list.Count)]
    $artist = ''
    if ($pick.song -and $pick.song.artists) { $artist = (@($pick.song.artists) | ForEach-Object { $_.name }) -join ' / ' }
    elseif ($pick.artists) { $artist = (@($pick.artists) | ForEach-Object { $_.name }) -join ' / ' }
    $track = [pscustomobject]@{
      id       = [string]$pick.id
      name     = [string]$pick.name
      artists  = $artist
      album    = [string]($pick.song.album.name)
      pic      = [string]$pick.picUrl
      duration = [int64]($pick.song.duration)
      feeTag   = '随机'
    }
    Write-Host ("随机到：" + $track.name + " — " + $track.artists) -ForegroundColor Cyan
    Play-Track $track
  } catch {
    Write-Host '随机播放取歌失败：' -NoNewline -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    exit 1
  }
}

function Search-Then-Pick([string]$q) {
  $p = Split-Query $q
  if (-not $p.name) { Write-Host '没有输入歌名' -ForegroundColor Yellow; exit 1 }
  if ($p.artist) { Write-Host ("搜索：" + $p.name + "  歌手：" + $p.artist) -ForegroundColor DarkGray }
  $songs = Search-Songs $p.name $p.artist
  Save-Cache $songs
  Print-Songs $songs
  if (-not $songs -or $songs.Count -eq 0) { exit 1 }
  $line = Read-Input '输入序号播放（直接回车退出）'
  if (-not $line -or $line.Trim() -eq '') { exit 0 }
  $idx = 0
  if (-not [int]::TryParse($line.Trim(), [ref]$idx)) { Write-Host '序号必须是数字' -ForegroundColor Yellow; exit 1 }
  if ($idx -lt 1 -or $idx -gt $songs.Count) { Write-Host '序号超出范围' -ForegroundColor Yellow; exit 1 }
  Play-Track $songs[$idx - 1]
}

function Show-Menu {
  Write-Host ''
  Write-Host '你要执行什么操作？'
  Write-Host '  1. 随机播放'
  Write-Host '  2. 搜索'
  Write-Host ''
  $sel = Read-Input '请输入序号'
  if (-not $sel -or $sel.Trim() -eq '') { exit 0 }
  switch ($sel.Trim()) {
    '1' { Play-Random }
    '2' {
      $q = Read-Input '输入歌名（可加空格再输入歌手，如：晴天 周杰伦）'
      if (-not $q -or $q.Trim() -eq '') { Write-Host '没有输入歌名' -ForegroundColor Yellow; exit 1 }
      Search-Then-Pick $q
    }
    default { Write-Host '没有这个选项' -ForegroundColor Yellow; exit 1 }
  }
}

function Save-Cache($songs) {
  if (-not (Test-Path -LiteralPath $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }
  $json = @($songs) | ConvertTo-Json -Depth 4
  Set-Content -LiteralPath $CacheFile -Value $json -Encoding UTF8
}

function Get-Cache {
  if (-not (Test-Path -LiteralPath $CacheFile)) { return @() }
  try {
    $j = Get-Content -LiteralPath $CacheFile -Raw -Encoding UTF8 | ConvertFrom-Json
    return @($j)
  } catch { return @() }
}

function Print-Songs($songs) {
  if (-not $songs -or $songs.Count -eq 0) { Write-Host '没有搜到结果' -ForegroundColor Yellow; return }
  $i = 0
  foreach ($s in $songs) {
    $i++
    $tag = if ($s.feeTag) { $s.feeTag } else { '免费' }
    Write-Host ("{0,2}. {1} — {2} 《{3}》 [{4}]  id={5}" -f $i, $s.name, $s.artists, $s.album, $tag, $s.id)
  }
}

function Play-Track($track) {
  if (-not (Test-Client)) {
    Write-Host 'MJMJ 客户端没有运行，请先启动 MJMJ。' -ForegroundColor Yellow
    exit 2
  }
  if ($track.feeTag -and $track.feeTag -ne '免费') {
    Write-Host ("提示：这首是 {0} 曲目，未登录会员可能只能试听或播放失败。" -f $track.feeTag) -ForegroundColor DarkYellow
  }
  $body = $track | ConvertTo-Json -Compress
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$ControlPort/cli/play" -Method Post -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
    Write-Host ("正在播放：{0} — {1}" -f $r.playing, $track.artists) -ForegroundColor Green
    exit 0
  } catch {
    Write-Host ("播放失败：" + $_.Exception.Message) -ForegroundColor Red
    exit 3
  }
}

# ---- 参数解析 ----
$a = @($ArgList)
if ($a.Count -eq 0) { Show-Menu; exit 0 }

switch ($a[0]) {
  '-h' { Show-Help; exit 0 }
  '--help' { Show-Help; exit 0 }
  '-s' {
    if ($a.Count -lt 2) { Write-Host '缺少搜索关键词' -ForegroundColor Yellow; exit 1 }
    $q = ($a[1..($a.Count - 1)] -join ' ')
    $p = Split-Query $q
    if ($p.artist) { Write-Host ("搜索：" + $p.name + "  歌手：" + $p.artist) -ForegroundColor DarkGray }
    $songs = Search-Songs $p.name $p.artist
    Save-Cache $songs
    Print-Songs $songs
    if (-not $songs -or $songs.Count -eq 0) { exit 1 }
    exit 0
  }
  '-p' {
    if ($a.Count -lt 2) { Write-Host '缺少序号' -ForegroundColor Yellow; exit 1 }
    $idx = 0
    if (-not [int]::TryParse([string]$a[1], [ref]$idx)) { Write-Host '序号必须是数字' -ForegroundColor Yellow; exit 1 }
    $songs = @(Get-Cache)
    if ($idx -lt 1 -or $idx -gt $songs.Count) {
      Write-Host '序号超出范围，先执行 mjplay -s <关键词>' -ForegroundColor Yellow
      exit 1
    }
    Play-Track $songs[$idx - 1]
  }
  '-k' {
    if ($a.Count -lt 2) { Write-Host '缺少歌曲 ID' -ForegroundColor Yellow; exit 1 }
    $id = [string]$a[1]
    $track = $null
    try {
      $d = Invoke-RestMethod -Uri "http://127.0.0.1:$SearchPort/api/song/detail?ids=$id" -TimeoutSec 20
      if ($d.songs -and $d.songs.Count -gt 0) { $track = Convert-Track $d.songs[0] }
    } catch { }
    if (-not $track) {
      $track = [pscustomobject]@{ id = $id; name = 'id ' + $id; artists = ''; album = ''; pic = ''; duration = 0; feeTag = '' }
    }
    Play-Track $track
  }
  default {
    Search-Then-Pick ($a -join ' ')
  }
}
