$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Test-CrmLogin([int]$Port, [int]$Timeout) {
    try {
        $reply = Invoke-WebRequest "http://127.0.0.1:$Port/login" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec $Timeout
        return $reply.StatusCode -eq 200 -and $reply.Content.Contains('CRM Access Portal')
    } catch {
        Write-Verbose "CRM login on port ${Port}: $($_.Exception.Message)"
        return $false
    }
}

$ports = @(3000, 3010)
$available = $null
foreach ($port in $ports) {
    $connection = [System.Net.Sockets.TcpClient]::new()
    try {
        $null = $connection.ConnectAsync('127.0.0.1', $port).GetAwaiter().GetResult()
        $listening = $connection.Connected
    } catch [System.Net.Sockets.SocketException] {
        if ($_.Exception.SocketErrorCode -ne 'ConnectionRefused') { throw }
        $listening = $false
    } finally {
        $connection.Dispose()
    }

    if ($listening -and (Test-CrmLogin $port 15)) {
        $url = "http://localhost:$port"
        Write-Host "The CRM is already running. Opening $url"
        Start-Process $url
        exit 0
    }

    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try {
        if (-not $listening) {
            $probe.ExclusiveAddressUse = $true
            $probe.Start()
            if ($null -eq $available) { $available = $port }
            continue
        }
    } catch [System.Net.Sockets.SocketException] {
        if ($_.Exception.SocketErrorCode -notin @('AddressAlreadyInUse', 'AccessDenied')) { throw }
    } finally {
        $probe.Stop()
    }

    Write-Host "Port $port is in use but is not serving the CRM login. Leaving that process alone."
}

if ($null -eq $available) { throw 'Both CRM ports (3000 and 3010) are in use. Close an unused server window and try again.' }

$corepack = Get-Command corepack.cmd -ErrorAction Stop
$env:NEXT_DIST_DIR = if ($available -eq 3000) { '.next-local' } else { '.next-local-alt' }
$url = "http://localhost:$available"
Write-Host "Starting the CRM at $url"
$watcher = Start-Job -ScriptBlock {
    param($Probe, $Port, $Url)
    $ProgressPreference = 'SilentlyContinue'
    $testLogin = [scriptblock]::Create($Probe)
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        if (& $testLogin $Port 5) {
            Write-Host "CRM ready: $Url"
            Start-Process $Url -ErrorAction Stop
            return
        }
        Start-Sleep -Seconds 1
    }
    Write-Warning "The CRM login did not become ready at $Url."
} -ArgumentList ${function:Test-CrmLogin}.ToString(), $available, $url

try {
    & $corepack.Source pnpm --filter '@crm/web' dev --hostname 127.0.0.1 --port $available
    $serverExit = $LASTEXITCODE
} finally {
    Stop-Job -Job $watcher
    try { Receive-Job -Job $watcher } finally { Remove-Job -Job $watcher }
}
exit $serverExit
