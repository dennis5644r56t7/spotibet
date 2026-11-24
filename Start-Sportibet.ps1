param()

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'Sportibet\logs'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

$services = @(
    @{ Name = 'backend'; Port = 5000; Directory = 'server'; Entry = 'node_modules\ts-node-dev\lib\bin.js'; Arguments = @('--respawn', '--transpile-only', 'src/index.ts') },
    @{ Name = 'frontend'; Port = 3001; Directory = 'client'; Entry = 'node_modules\next\dist\bin\next'; Arguments = @('dev', '-p', '3001') }
)

function Test-ServicePort([int] $Port) {
    $connection = [System.Net.Sockets.TcpClient]::new()
    try {
        $pending = $connection.ConnectAsync('localhost', $Port)
        return ($pending.Wait(1000) -and $connection.Connected)
    } catch {
        return $false
    } finally {
        $connection.Dispose()
    }
}

foreach ($service in $services) {
    if (Test-ServicePort -Port $service.Port) {
        Write-Host "$($service.Name) already running on port $($service.Port)."
        continue
    }
    $serviceDirectory = Join-Path $projectRoot $service.Directory
    $serviceEntry = Join-Path $serviceDirectory $service.Entry
    if (-not (Test-Path -LiteralPath $serviceEntry)) {
        throw "Dependencies missing for $($service.Name). Run npm install in $serviceDirectory."
    }
    $serviceProcess = Start-Process -FilePath $nodeExecutable -WorkingDirectory $serviceDirectory `
        -ArgumentList (@(('"{0}"' -f $serviceEntry)) + $service.Arguments) `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDirectory "$($service.Name).log") `
        -RedirectStandardError (Join-Path $runtimeDirectory "$($service.Name).error.log")
    Write-Host "Starting $($service.Name) on port $($service.Port) (PID $($serviceProcess.Id))."
}

Write-Host 'Sportibet: http://localhost:3001'
Write-Host "Startup logs: $runtimeDirectory"
