@echo off
REM Crypto Data Management - Container Start Script (Windows)
REM This script starts the PostgreSQL container without modifying the database

echo Starting Crypto Data Management Database...
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not installed. Please install Docker Desktop first:
    echo https://docs.docker.com/desktop/install/windows-install/
    exit /b 1
)

REM Check if Docker daemon is running
docker ps >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker Desktop is not running. Please start Docker Desktop first.
    exit /b 1
)

REM Start PostgreSQL container
echo Starting PostgreSQL container...
docker-compose up -d postgres

REM Wait for PostgreSQL to be ready
echo Waiting for PostgreSQL to be ready...
timeout /t 5 /nobreak >nul

:waitloop
docker exec crypto-postgres pg_isready -U postgres >nul 2>&1
if %errorlevel% neq 0 (
    echo Still waiting for PostgreSQL...
    timeout /t 2 /nobreak >nul
    goto waitloop
)

echo.
echo ================================================================
echo PostgreSQL is ready!
echo Database: crypto_data
echo Host: localhost:5432
echo ================================================================
echo.

REM Start backend server in new window
echo Starting backend server...
start "Crypto Backend" cmd /k "cd /d %~dp0backend && npm run dev"

REM Wait a moment before starting frontend
timeout /t 2 /nobreak >nul

REM Start frontend server in new window
echo Starting frontend server...
start "Crypto Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ================================================================
echo All services started!
echo.
echo Backend:  Running in 'Crypto Backend' window
echo Frontend: Running in 'Crypto Frontend' window
echo Database: crypto-postgres container
echo.
echo Open your browser to:
echo    http://localhost:5173
echo.
echo ================================================================
echo.
echo To stop all services:
echo    1. Close the backend and frontend terminal windows (or press Ctrl+C in each)
echo    2. Run stop.bat to stop the database
echo.
echo To view database logs:
echo    docker logs crypto-postgres
echo ================================================================
echo.
