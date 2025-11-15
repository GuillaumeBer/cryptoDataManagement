@echo off
setlocal enabledelayedexpansion
REM Crypto Data Management - Stop All Services Script (Windows)
REM This script stops backend, frontend, and PostgreSQL container

echo Stopping Crypto Data Management Services...
echo.

REM Stop frontend server (port 5173)
echo Stopping frontend server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo Frontend server stopped.

REM Stop backend server (port 3000)
echo Stopping backend server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo Backend server stopped.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not installed.
    exit /b 1
)

REM Stop the PostgreSQL container
echo Stopping PostgreSQL container...
docker-compose down >nul 2>&1
if %errorlevel% equ 0 (
    echo PostgreSQL container stopped.
)

echo.
echo ================================================================
echo All services stopped successfully!
echo.
echo Your data is safely stored in the Docker volume 'postgres_data'
echo.
echo To start all services again, run:
echo    start.bat
echo ================================================================
echo.
