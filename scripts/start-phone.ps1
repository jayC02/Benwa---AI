$ErrorActionPreference = 'Stop'
$benwaDirectory = Split-Path -Parent $PSScriptRoot
$phoneDirectory = Join-Path $benwaDirectory '.data\phone'
New-Item -ItemType Directory -Force -Path $phoneDirectory | Out-Null
$accessFile = Join-Path $phoneDirectory 'access.json'
if (Test-Path -LiteralPath $accessFile) {
    $phoneClient = [System.Net.Sockets.TcpClient]::new()
    try { $phoneClient.Connect('127.0.0.1', 4342) }
    catch { Remove-Item -LiteralPath $accessFile }
    finally { $phoneClient.Dispose() }
}
if (-not (Test-Path -LiteralPath $accessFile)) {
    Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('--import', 'tsx', 'scripts/phone.ts') -WorkingDirectory $benwaDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $phoneDirectory 'launcher.log') -RedirectStandardError (Join-Path $phoneDirectory 'launcher-error.log')
    for ($attempt = 0; $attempt -lt 180; $attempt++) {
        if (Test-Path -LiteralPath $accessFile) { break }
        Start-Sleep -Seconds 1
    }
}
if (-not (Test-Path -LiteralPath $accessFile)) {
    Write-Host 'Phone access did not become ready. Check .data\phone\launcher-error.log.'
    Read-Host 'Press Enter to close'
    exit 1
}
Start-Process notepad.exe -ArgumentList ('"' + (Join-Path $phoneDirectory 'login.txt') + '"')
