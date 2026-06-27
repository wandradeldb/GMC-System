#Requires -Version 5.0

param([switch]$NoWait)

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    Write-Host "[*] $Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "[+] $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[!] $Message" -ForegroundColor Red
}

# Setup
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

# Check Node.js
Write-Header "GMC System - Startup v2"
Write-Step "Checking Node.js..."
$NodeVersion = node --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Node.js not found. Download from https://nodejs.org"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Success "Found $NodeVersion"

# Install dependencies if needed
Write-Step "Checking dependencies..."
if (-not (Test-Path "$ProjectDir\server\node_modules")) {
    Write-Host "  Installing backend dependencies..."
    Set-Location "$ProjectDir\server"
    npm install | Out-Null
}
if (-not (Test-Path "$ProjectDir\client\node_modules")) {
    Write-Host "  Installing frontend dependencies..."
    Set-Location "$ProjectDir\client"
    npm install | Out-Null
}
Write-Success "Dependencies ready"

# Create logs directory
if (-not (Test-Path "$ProjectDir\logs")) {
    New-Item -ItemType Directory -Path "$ProjectDir\logs" | Out-Null
}

# Start Backend
Write-Header "Starting servers..."
Write-Step "Starting Backend (API on port 3001)..."
$BackendLog = "$ProjectDir\logs\backend.log"
$BackendProcess = Start-Process -FilePath "node" -ArgumentList "index.js" `
    -WorkingDirectory "$ProjectDir\server" `
    -NoNewWindow -RedirectStandardOutput $BackendLog -PassThru

Write-Success "Backend started (PID: $($BackendProcess.Id))"

# Wait for backend to be ready
Start-Sleep -Seconds 2

# Start Frontend
Write-Step "Starting Frontend (Vite on port 5173)..."
$FrontendLog = "$ProjectDir\logs\frontend.log"
$FrontendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" `
    -WorkingDirectory "$ProjectDir\client" `
    -NoNewWindow -RedirectStandardOutput $FrontendLog -PassThru

Write-Success "Frontend started (PID: $($FrontendProcess.Id))"

# Wait for servers to be ready
Write-Step "Waiting for servers to start..."
Start-Sleep -Seconds 8

# Check if servers are still running
$BackendReady = Get-Process -Id $BackendProcess.Id -ErrorAction SilentlyContinue
$FrontendReady = Get-Process -Id $FrontendProcess.Id -ErrorAction SilentlyContinue

# Report status
Write-Header "GMC System Status"
if ($BackendReady) {
    Write-Success "Backend running at http://localhost:3001"
} else {
    Write-Error-Custom "Backend failed to start (check $BackendLog)"
}

if ($FrontendReady) {
    Write-Success "Frontend running at http://localhost:5173"
} else {
    Write-Error-Custom "Frontend failed to start (check $FrontendLog)"
}

Write-Host ""
Write-Host "  Backend:  http://localhost:3001" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host "  Logs:     $ProjectDir\logs\" -ForegroundColor Cyan
Write-Host ""

# Open browser
if ($BackendReady -and $FrontendReady) {
    Write-Host "Opening browser..." -ForegroundColor Yellow
    Start-Process "http://localhost:5173"
}

# Keep process alive
if (-not $NoWait) {
    Write-Host "Servers running. Press Ctrl+C to stop all processes." -ForegroundColor Yellow
    try {
        while ($true) {
            if (-not (Get-Process -Id $BackendProcess.Id -ErrorAction SilentlyContinue)) {
                Write-Error-Custom "Backend process stopped!"
                break
            }
            if (-not (Get-Process -Id $FrontendProcess.Id -ErrorAction SilentlyContinue)) {
                Write-Error-Custom "Frontend process stopped!"
                break
            }
            Start-Sleep -Seconds 5
        }
    } finally {
        Write-Host "Stopping servers..." -ForegroundColor Yellow
        Get-Process -Id $BackendProcess.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Get-Process -Id $FrontendProcess.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Success "Servers stopped"
    }
}
