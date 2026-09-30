[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4318
)

$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction Stop
$previousPantaKey = [Environment]::GetEnvironmentVariable('PANTA_API_KEY', 'Process')
$previousPort = [Environment]::GetEnvironmentVariable('PORT', 'Process')
$keyBuffer = [IntPtr]::Zero
$keyInput = $null

try {
    Write-Host 'Resolution Lens: local read-only Panta connection'
    Write-Host 'Use your own developer key. Input is masked and is not saved to a file.'
    Write-Host 'Panta requests occur only after you choose Load live markets in the browser.'
    $keyInput = Read-Host 'Panta API key' -AsSecureString
    if ($keyInput.Length -eq 0) { throw 'No key entered. Server was not started.' }
    $keyBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyInput)
    [Environment]::SetEnvironmentVariable('PANTA_API_KEY', [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyBuffer), 'Process')
    [Environment]::SetEnvironmentVariable('PORT', [string]$Port, 'Process')
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'server.mjs')
} finally {
    [Environment]::SetEnvironmentVariable('PANTA_API_KEY', $previousPantaKey, 'Process')
    [Environment]::SetEnvironmentVariable('PORT', $previousPort, 'Process')
    if ($keyBuffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyBuffer) }
    if ($null -ne $keyInput) { $keyInput.Dispose() }
}
