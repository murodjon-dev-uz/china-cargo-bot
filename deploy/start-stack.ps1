$ErrorActionPreference = 'Stop'

$ProjectPath = 'C:\Users\User\Documents\ccl-tracking-bot'
$DockerDesktop = 'C:\Users\User\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe'
$DockerCli = 'C:\Users\User\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
$LogDirectory = Join-Path $ProjectPath 'logs'
$LogFile = Join-Path $LogDirectory 'startup.log'

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
Start-Transcript -Path $LogFile -Append

try {
    Write-Output "[$(Get-Date -Format o)] Starting China Cargo stack"

    if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $DockerDesktop -WindowStyle Hidden
        Write-Output 'Docker Desktop launch requested'
    }

    $Ready = $false
    for ($Attempt = 1; $Attempt -le 60; $Attempt++) {
        if (Test-Path -LiteralPath '\\.\pipe\dockerDesktopLinuxEngine') {
            $Ready = $true
            break
        }
        Start-Sleep -Seconds 5
    }

    if (-not $Ready) {
        throw 'Docker Engine did not become ready within 5 minutes'
    }

    Set-Location -LiteralPath $ProjectPath
    & $DockerCli compose up -d
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up failed with exit code $LASTEXITCODE"
    }

    Write-Output "[$(Get-Date -Format o)] China Cargo stack is running"
}
catch {
    Write-Error $_
    exit 1
}
finally {
    Stop-Transcript
}
