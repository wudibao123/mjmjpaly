# 安装/卸载时把 cli 目录登记到用户级 PATH（HKCU\Environment，REG_EXPAND_SZ）
# 只改自身这一条，其余条目原样保留（按未展开的原始字符串读写，避免 %VAR% 被固化）
param(
  [ValidateSet('add', 'remove')][string]$Action = 'add',
  [Parameter(Mandatory = $true)][string]$Dir
)

$ErrorActionPreference = 'SilentlyContinue'
$norm = $Dir.TrimEnd('\')

$rk = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if (-not $rk) { $rk = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }

$raw = [string]$rk.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$parts = @($raw -split ';' | Where-Object { $_.Trim() -ne '' })
$keep = @($parts | Where-Object { $_.TrimEnd('\') -ne $norm })

if ($Action -eq 'add') {
  $new = (@($keep + $norm) -join ';')
} else {
  $new = ($keep -join ';')
}

$rk.SetValue('Path', $new, [Microsoft.Win32.RegistryValueKind]::ExpandString)
$rk.Close()

# 广播环境变量变更，让新的资源管理器/终端读到新 PATH
try {
  Add-Type -Namespace Win32 -Name Native -MemberDefinition '[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
  $res = [UIntPtr]::Zero
  [Win32.Native]::SendMessageTimeout([IntPtr]0, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$res) | Out-Null
} catch { }
