# Crypto Data Management - Container Start Script (PowerShell)
# This script starts the PostgreSQL container without modifying the database

Write-Host "Starting Crypto Data Management Database..." -ForegroundColor Cyan
Write-Host ""

# Check if Docker is installed
try {
    $null = docker --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker not found"
    }
} catch {
    Write-Host "Docker is not installed. Please install Docker Desktop first:" -ForegroundColor Red
    Write-Host "https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Yellow
    exit 1
}

# Check if Docker daemon is running
try {
    $null = docker ps 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker Desktop is not running. Please start Docker Desktop first." -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "Docker Desktop is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Start PostgreSQL container
Write-Host "Starting PostgreSQL container..." -ForegroundColor Yellow
docker-compose up -d postgres

# Wait for PostgreSQL to be ready
Write-Host "Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$maxAttempts = 30
$attempt = 0
while ($attempt -lt $maxAttempts) {
    $null = docker exec crypto-postgres pg_isready -U postgres 2>&1
    if ($LASTEXITCODE -eq 0) {
        break
    }
    Write-Host "Still waiting for PostgreSQL..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    $attempt++
}

if ($attempt -ge $maxAttempts) {
    Write-Host "PostgreSQL failed to start within the timeout period." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "PostgreSQL is ready!" -ForegroundColor Green
Write-Host "Database: crypto_data"
Write-Host "Host: localhost:5432"
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Start backend server in new window
Write-Host "Starting backend server..." -ForegroundColor Yellow
$backendPath = Join-Path $PSScriptRoot "backend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendPath'; npm run dev" -WindowStyle Normal

# Wait a moment before starting frontend
Start-Sleep -Seconds 2

# Start frontend server in new window
Write-Host "Starting frontend server..." -ForegroundColor Yellow
$frontendPath = Join-Path $PSScriptRoot "frontend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendPath'; npm run dev" -WindowStyle Normal

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "All services started!" -ForegroundColor Green
Write-Host ""
Write-Host "Backend:  Running in separate PowerShell window"
Write-Host "Frontend: Running in separate PowerShell window"
Write-Host "Database: crypto-postgres container"
Write-Host ""
Write-Host "Open your browser to:" -ForegroundColor Cyan
Write-Host "   http://localhost:5173" -ForegroundColor Yellow
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "To stop all services:" -ForegroundColor Cyan
Write-Host "   .\stop.ps1" -ForegroundColor Yellow
Write-Host ""
Write-Host "To view database logs:" -ForegroundColor Cyan
Write-Host "   docker logs crypto-postgres" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
