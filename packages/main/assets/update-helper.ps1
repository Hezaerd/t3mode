# Installs a T3 Code update after T3 Code quits, then puts the t3mode shim back.
# Started detached by the t3mode loader (packages/main/src/Updater.ts) from Electron's will-quit.
#   1. Wait for every T3 Code process to exit, stopping plugin tool servers that run its exe.
#   2. Run the downloaded installer silently, the way electron-updater does (--updated /S),
#      and wait for that process.
#   3. Re-apply the shim with repair.cjs, run by T3 Code's own exe in Node mode.
#   4. After "Restart now", start T3 Code again with the arguments it had.
# It must not be T3 Code's exe itself: the installer replaces that exe while this script runs.
param(
  [Parameter(Mandatory)] [int] $ParentPid,
  [Parameter(Mandatory)] [string] $Installer,
  [Parameter(Mandatory)] [string] $InstallDir,
  [Parameter(Mandatory)] [string] $RepairJs,
  [Parameter(Mandatory)] [string] $ShimJs,
  [Parameter(Mandatory)] [string] $HomeDir,
  [Parameter(Mandatory)] [string] $Log,
  [string] $Version = "",
  [string] $Relaunch = "0",
  [string] $RelaunchArgs = "",
  [string] $KeepUpdaterEnv = "0"
)

$ErrorActionPreference = "Stop"

function Write-Log([string] $Message) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Log) | Out-Null
    Add-Content -LiteralPath $Log -Value ("{0} {1}" -f (Get-Date).ToString("o"), $Message)
  } catch {}
}

# Windows command-line quoting: Start-Process joins arguments with spaces and quotes nothing.
function Format-Argument([string] $Value) {
  if ($Value -ne "" -and $Value -notmatch '[\s"]') { return $Value }
  $escaped = $Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

function Get-T3Processes {
  $prefix = $InstallDir.TrimEnd("\") + "\"
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    })
}

# Plugin tool servers run T3 Code's exe, started by Claude or Codex, so they can outlive T3 Code
# and would hold the update. Stops every process of an exe in the install folder whose command
# line names a file under <home>\plugins\ (the same match as stopProcessesScript in
# packages/shared/src/ToolServers.ts). Get-Process has no CommandLine in Windows PowerShell 5.1.
function Stop-PluginProcesses {
  try {
    $prefix = $InstallDir.TrimEnd("\") + "\"
    $plugins = (Join-Path $HomeDir "plugins").TrimEnd("\") + "\"
    $found = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and $_.ExecutablePath -and $_.CommandLine -and
        $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and
        $_.CommandLine.IndexOf($plugins, [StringComparison]::OrdinalIgnoreCase) -ge 0
      })
    if ($found.Count -eq 0) { return }
    foreach ($p in $found) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($p in $found) { Wait-Process -Id $p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }
    Write-Log "Stopped $($found.Count) plugin process(es): $(($found | ForEach-Object { $_.ProcessId }) -join ', ')"
  } catch {
    Write-Log "Could not stop plugin processes: $_"
  }
}

function Get-T3Exe {
  Get-ChildItem -LiteralPath $InstallDir -Filter "*.exe" |
    Where-Object { $_.Name -notlike "Uninstall*" } |
    Select-Object -First 1
}

$mutex = New-Object System.Threading.Mutex($false, "Local\t3mode-update-helper")
if (-not $mutex.WaitOne(0)) {
  Write-Log "Another update helper is running; this one stops."
  exit 0
}

try {
  Write-Log "Update to $Version`: waiting for T3 Code (pid $ParentPid) to exit"
  try { Wait-Process -Id $ParentPid -Timeout 120 -ErrorAction SilentlyContinue } catch {}
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-T3Processes).Count -gt 0) {
    Stop-PluginProcesses
    if ((Get-T3Processes).Count -eq 0) { break }
    if ((Get-Date) -gt $deadline) {
      Write-Log "T3 Code is still running after 2 minutes; the update is skipped until the next quit."
      exit 1
    }
    Start-Sleep -Milliseconds 500
  }

  Write-Log "Running $Installer"
  $install = Start-Process -FilePath $Installer -ArgumentList "--updated", "/S" -Wait -PassThru -WindowStyle Hidden
  Write-Log "Installer exited with code $($install.ExitCode)"

  # Re-apply the shim whatever the installer did: a failed install may still have replaced app.asar.
  $exe = Get-T3Exe
  if (-not $exe) { throw "No T3 Code executable in $InstallDir after the install." }
  $out = Join-Path $env:TEMP "t3mode-repair.out.txt"
  $err = Join-Path $env:TEMP "t3mode-repair.err.txt"
  $env:ELECTRON_RUN_AS_NODE = "1"
  $repairArgs = @($RepairJs, $InstallDir, $ShimJs, $HomeDir) | ForEach-Object { Format-Argument $_ }
  $repair = Start-Process -FilePath $exe.FullName -ArgumentList $repairArgs -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput $out -RedirectStandardError $err
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $output = ((Get-Content -LiteralPath $out, $err -ErrorAction SilentlyContinue) -join " ").Trim()
  Write-Log "Shim repair exited with code $($repair.ExitCode): $output"
  Remove-Item -LiteralPath $out, $err -ErrorAction SilentlyContinue

  if ($Relaunch -eq "1") {
    # The new launch decides for itself whether T3 Code's updater stays off.
    if ($KeepUpdaterEnv -ne "1") { Remove-Item Env:T3CODE_DISABLE_AUTO_UPDATE -ErrorAction SilentlyContinue }
    $arguments = @()
    if ($RelaunchArgs) {
      $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RelaunchArgs))
      # Windows PowerShell emits a JSON array as one object; foreach over it gets the items.
      $items = ConvertFrom-Json $json
      foreach ($item in $items) { $arguments += Format-Argument ([string] $item) }
    }
    Write-Log "Starting $($exe.FullName)"
    if ($arguments.Count -gt 0) {
      Start-Process -FilePath $exe.FullName -ArgumentList $arguments | Out-Null
    } else {
      Start-Process -FilePath $exe.FullName | Out-Null
    }
  }
  Write-Log "Update helper done"
} catch {
  Write-Log "Update helper failed: $_"
  exit 1
} finally {
  $mutex.ReleaseMutex()
}
