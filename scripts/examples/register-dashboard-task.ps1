<#
.SYNOPSIS
  Register (or unregister) a Windows Task Scheduler task that runs the
  sdlc dashboard HTML watcher at logon for the current user (hidden).

.DESCRIPTION
  Does not start the watcher immediately; it creates a logon trigger so
  dashboard-watch.mjs (next to this script) keeps reports/dashboard.html
  up to date in the background. No time limit: the task runs until logoff.

  DO NOT run this in CI blindly. Review -ProjectRoot / -Cli first.

.PARAMETER ProjectRoot
  Absolute path to the sdlc project root (directory with openspec/sdlc.yaml).

.PARAMETER Out
  Dashboard output path relative to ProjectRoot (default: reports/dashboard.html).

.PARAMETER Cli
  CLI command string passed to --cli (default: sdlc).

.PARAMETER TaskName
  Task Scheduler task name (default: sdlc-dashboard-watch).

.PARAMETER Unregister
  Remove the named task instead of registering it.

.EXAMPLE
  .\scripts\examples\register-dashboard-task.ps1 -ProjectRoot C:\work\my-app

.EXAMPLE
  .\scripts\examples\register-dashboard-task.ps1 -ProjectRoot C:\work\my-app -Unregister
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string] $ProjectRoot = (Get-Location).Path,

  [Parameter(Mandatory = $false)]
  [string] $Out = 'reports/dashboard.html',

  [Parameter(Mandatory = $false)]
  [string] $Cli = 'sdlc',

  [Parameter(Mandatory = $false)]
  [string] $TaskName = 'sdlc-dashboard-watch',

  [Parameter(Mandatory = $false)]
  [switch] $Unregister
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw 'node.exe not found on PATH; install Node.js >= 20.19'
  }
  return $cmd.Source
}

if ($Unregister) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Unregistered task: $TaskName"
  } else {
    Write-Host "Task not found: $TaskName"
  }
  return
}

$root = [System.IO.Path]::GetFullPath($ProjectRoot)
$marker = Join-Path $root 'openspec\sdlc.yaml'
if (-not (Test-Path -LiteralPath $marker)) {
  throw "Not an sdlc project root (missing openspec/sdlc.yaml): $root"
}

$scriptPath = Join-Path $PSScriptRoot 'dashboard-watch.mjs'
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Watcher script not found: $scriptPath"
}

$node = Get-NodeExe
# node.exe is a console program: run it through a hidden PowerShell so no window stays open.
$cliArg = $Cli.Replace("'", "''")
$command = "& '{0}' '{1}' --out '{2}' --cli '{3}'" -f $node, $scriptPath, $Out, $cliArg
$argList = "-NoProfile -WindowStyle Hidden -Command `"$command`""
$powershell = Join-Path $PSHOME 'powershell.exe'

$action = New-ScheduledTaskAction -Execute $powershell -Argument $argList -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Host "Registered hidden logon task '$TaskName' for $env:USERNAME"
Write-Host "  WorkingDirectory: $root"
Write-Host "  Command: $powershell $argList"
