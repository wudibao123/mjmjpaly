# MJMJ 代码签名证书：生成自签名证书 + 安装到本机受信任根/受信任发布者
# 目的：签名后的 EXE/安装包在本机被 Windows Defender 与 SmartScreen 信任，不再拦截启动
#
# 密码来源：环境变量 MJMJ_CERT_PWD。未设置时脚本随机生成一个并打印出来，请自行保存。
# 仓库不保存任何证书密码；导出的 pfx 也不要提交到版本库。
$ErrorActionPreference = 'Stop'
$certName = 'MJMJ Player Code Signing'
$outDir = Join-Path $PSScriptRoot '..\dist'
$pfxPath = Join-Path $outDir 'mjmj-code-sign.pfx'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 0. 取证书密码
$plain = $env:MJMJ_CERT_PWD
$generated = $false
if ([string]::IsNullOrWhiteSpace($plain)) {
    $bytes = New-Object byte[] 18
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $plain = [Convert]::ToBase64String($bytes)
    $generated = $true
}
$pwd = ConvertTo-SecureString -String $plain -Force -AsPlainText

# 1. 生成代码签名证书（3 年有效期）
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=$certName" -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(3)

# 2. 导出 PFX（用于 signtool 签名）
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pwd -Exportable | Out-Null

# 3. 安装到当前用户受信任根证书颁发机构 + 受信任发布者（本机完全信任该签名）
Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\CurrentUser\Root -Password $pwd | Out-Null
Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\CurrentUser\TrustedPublisher -Password $pwd | Out-Null

"PFX=$pfxPath"
"CERT_THUMB=$($cert.Thumbprint)"
if ($generated) {
    "CERT_PASSWORD_GENERATED=$plain"
    "请把上面这行密码保存好，后续签名时以环境变量 MJMJ_CERT_PWD 提供；本脚本不会再次显示它。"
}
"CERT_INSTALLED_OK"
