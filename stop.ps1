# Crypto Data Management - Stop All Services Script (PowerShell)
# This script stops backend, frontend, and PostgreSQL container

Write-Host "Stopping Crypto Data Management Services..." -ForegroundColor Cyan
Write-Host ""

# Stop frontend server (port 5173)
Write-Host "Stopping frontend server..." -ForegroundColor Yellow
$frontendProcesses = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($frontendProcesses) {
    foreach ($conn in $frontendProcesses) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Frontend server stopped." -ForegroundColor Green
} else {
    Write-Host "Frontend server not running." -ForegroundColor Gray
}

# Stop backend server (port 3000)
Write-Host "Stopping backend server..." -ForegroundColor Yellow
$backendProcesses = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($backendProcesses) {
    foreach ($conn in $backendProcesses) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Backend server stopped." -ForegroundColor Green
} else {
    Write-Host "Backend server not running." -ForegroundColor Gray
}

# Check if Docker is installed
try {
    $null = docker --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker not found"
    }
} catch {
    Write-Host "Docker is not installed." -ForegroundColor Red
    exit 1
}

# Stop the PostgreSQL container
Write-Host "Stopping PostgreSQL container..." -ForegroundColor Yellow
$null = docker-compose down 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "PostgreSQL container stopped." -ForegroundColor Green
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "All services stopped successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Your data is safely stored in the Docker volume 'postgres_data'"
Write-Host ""
Write-Host "To start all services again, run:" -ForegroundColor Cyan
Write-Host "   .\start.ps1" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
