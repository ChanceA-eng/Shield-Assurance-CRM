param(
  [ValidateSet('Install', 'Start', 'Stop', 'Status', 'Run')]
  [string]$Action = 'Status'
)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'ShieldAssurance\SecureIntake'
$taskName = 'Shield Assurance Secure Intake'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'run-local-intake.cjs'

function Get-WorkerProcess {
  $lock = Join-Path $root 'worker.lock'
  if (-not (Test-Path -LiteralPath $lock)) { return $null }
  $workerId = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $lock -Raw).Trim(), [ref]$workerId) -or $workerId -le 0) { throw 'Invalid local worker lock. Inspect it before restarting.' }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $workerId"
  if ($process -and $process.ExecutablePath -eq $node -and $process.CommandLine.Contains($runner)) { return $process }
  return $null
}

function Stop-WorkerTree([int]$WorkerId) {
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $WorkerId")) {
    Stop-WorkerTree ([int]$child.ProcessId)
  }
  if (Get-Process -Id $WorkerId -ErrorAction SilentlyContinue) { Stop-Process -Id $WorkerId -Force -ErrorAction Stop }
}

function Protect-Directory([string]$Path) {
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  & icacls.exe $Path /inheritance:r /grant:r "*$($sid.Value):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Private worker directory permissions could not be configured.' }
}

if ($Action -eq 'Install') {
  Protect-Directory $root
  foreach ($directory in @('downloads', 'database', 'temp', 'logs', 'gnupg')) {
    Protect-Directory (Join-Path $root $directory)
  }
  $version = '1.5.4'
  $zip = Join-Path $root "downloads\clamav-$version.win.x64.zip"
  $signature = "$zip.sig"
  $key = Join-Path $root 'downloads\cisco-talos.gpg'
  $gpg = Join-Path ${env:ProgramFiles} 'Git\usr\bin\gpg.exe'
  if (-not (Test-Path -LiteralPath $gpg)) { throw 'Git for Windows GPG is required to verify the official ClamAV download before execution.' }
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  if (-not (Test-Path -LiteralPath $zip)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://www.clamav.net/downloads/production/clamav-$version.win.x64.zip" -OutFile $zip -TimeoutSec 600
  }
  Invoke-WebRequest -UseBasicParsing -Uri "https://www.clamav.net/downloads/production/clamav-$version.win.x64.zip.sig" -OutFile $signature -TimeoutSec 60
  Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/Cisco-Talos/clamav-documentation/main/src/manual/cisco-talos.gpg' -OutFile $key -TimeoutSec 60
  Push-Location $root
  try {
    & $gpg --homedir gnupg --batch --import $key
    if ($LASTEXITCODE -ne 0) { throw 'Official Cisco Talos signing key import failed.' }
    & $gpg --homedir gnupg --batch --verify $signature $zip
    if ($LASTEXITCODE -ne 0) { throw 'ClamAV download signature is invalid. No executable was installed.' }
  } finally { Pop-Location }
  $install = Join-Path $root "clamav-$version"
  if (-not (Test-Path -LiteralPath $install)) { Expand-Archive -LiteralPath $zip -DestinationPath $install }
  $executables = @(Get-ChildItem -LiteralPath $install -Filter clamscan.exe -Recurse)
  if ($executables.Count -ne 1) { throw 'Expected exactly one verified ClamAV executable.' }
  $bin = $executables[0].Directory.FullName
  $config = @(
    ('DatabaseDirectory "' + (Join-Path $root 'database') + '"'),
    'DatabaseMirror database.clamav.net',
    'TestDatabases yes',
    'ConnectTimeout 30',
    'ReceiveTimeout 120',
    ('UpdateLogFile "' + (Join-Path $root 'logs\freshclam.log') + '"'),
    'LogFileMaxSize 5M',
    'LogTime yes',
    'LogRotate yes'
  ) -join "`r`n"
  [IO.File]::WriteAllText((Join-Path $root 'freshclam.conf'), $config + "`r`n", (New-Object Text.UTF8Encoding($false)))
  $settings = @{ bin = $bin; repository = $repo; oracleEnabled = $false } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $root 'settings.json'), $settings, (New-Object Text.UTF8Encoding($false)))
  & (Join-Path $bin 'freshclam.exe') "--config-file=$(Join-Path $root 'freshclam.conf')"
  if ($LASTEXITCODE -ne 0) { throw 'Signature initialization failed. Uploads remain disabled.' }
  Write-Output "Verified ClamAV installed privately at $install. Oracle is disabled."
  exit 0
}

if ($Action -eq 'Run') {
  $env:CRM_LOCAL_INTAKE_HOME = $root
  & $node $runner
  exit $LASTEXITCODE
}
if ($Action -eq 'Start') {
  if (-not (Test-Path -LiteralPath (Join-Path $root 'settings.json'))) { throw 'Run this script with -Action Install first.' }
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $arguments = '"' + $runner + '"'
  $taskAction = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Private local Secure Intake scanning and retention cleanup. Oracle disabled. Runs only while this user is signed in.' -Force | Out-Null
  if (-not (Get-WorkerProcess)) { Start-ScheduledTask -TaskName $taskName }
  Write-Output 'Local Secure Intake worker scheduled now and at sign-in. Keep this computer awake.'
}
if ($Action -eq 'Stop') {
  $worker = Get-WorkerProcess
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) { Disable-ScheduledTask -TaskName $taskName | Out-Null }
  if ($worker) { Stop-WorkerTree ([int]$worker.ProcessId) }
  if ($task) { Stop-ScheduledTask -TaskName $taskName }
  $temporaryDirectory = Join-Path $root 'temp'
  if (Test-Path -LiteralPath $temporaryDirectory) {
    foreach ($directory in @(Get-ChildItem -LiteralPath $temporaryDirectory -Directory)) {
      if ($directory.Name.StartsWith('crm-prospect-scan-') -and -not ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $directory.FullName -Recurse -Force
      }
    }
  }
  Write-Output 'Local Secure Intake task stopped and disabled. Upload issuance closes when its heartbeat expires.'
}
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) { $task | Select-Object TaskName, State }
$worker = Get-WorkerProcess
if ($worker) { Write-Output "Verified local worker process: $($worker.ProcessId)" }
else { Write-Output 'Local worker is not running. Any status below is its last recorded status.' }
$status = Join-Path $root 'status.json'
if (Test-Path -LiteralPath $status) { Get-Content -LiteralPath $status }
else { Write-Output 'No local worker status yet.' }
