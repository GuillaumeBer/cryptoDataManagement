@echo off
REM Crypto Data Management - Quick Start Script (Windows)

echo Starting Crypto Data Management System...
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not installed. Please install Docker Desktop first:
    echo https://docs.docker.com/desktop/install/windows-install/
    exit /b 1
)

REM Start PostgreSQL with Docker Compose
echo Starting PostgreSQL database...
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

echo PostgreSQL is ready!
echo.

REM Setup backend
echo Setting up backend...
cd backend

if not exist "node_modules" (
    echo Installing backend dependencies...
    call npm install
)

if not exist ".env" (
    echo Creating .env file...
    copy .env.example .env
)

echo Running database migrations...
call npm run db:migrate

echo Backend setup complete!
echo.

REM Setup frontend
echo Setting up frontend...
cd ..\frontend

if not exist "node_modules" (
    echo Installing frontend dependencies...
    call npm install
)

if not exist ".env" (
    echo Creating .env file...
    copy .env.example .env
)

echo Frontend setup complete!
echo.

REM Instructions
echo ================================================================
echo Setup Complete! Next steps:
echo.
echo 1. Start the backend (in one terminal):
echo    cd backend ^&^& npm run dev
echo.
echo 2. Start the frontend (in another terminal):
echo    cd frontend ^&^& npm run dev
echo.
echo 3. Open your browser to:
echo    http://localhost:5173
echo.
echo 4. Click 'Fetch Initial Data' to load funding rates
echo ================================================================
echo.
echo To stop the database later, run: docker-compose down
echo.

cd ..
