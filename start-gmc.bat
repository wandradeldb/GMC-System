@echo off
setlocal enabledelayedexpansion
color 0A

cls
echo.
echo ========================================
echo   GMC System - Startup v2
echo ========================================
echo.

set PROJECT_DIR=%~dp0

REM Check Node.js
echo [*] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
  color 0C
  echo [!] Error: Node.js not installed
  echo     Download from: https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo [+] Found %NODE_VER%

REM Check dependencies
echo [*] Checking dependencies...
cd /d "%PROJECT_DIR%server"
if not exist "node_modules" (
  echo     Installing backend dependencies...
  call npm install
)
cd /d "%PROJECT_DIR%client"
if not exist "node_modules" (
  echo     Installing frontend dependencies...
  call npm install
)
echo [+] Dependencies ready

REM Create logs directory
if not exist "%PROJECT_DIR%logs" mkdir "%PROJECT_DIR%logs"

echo.
echo ========================================
echo   Starting servers...
echo ========================================
echo.

REM Start Backend
echo [*] Starting Backend (API)...
cd /d "%PROJECT_DIR%server"
start "GMC-Backend" cmd /k "cls & echo. & echo =============================== & echo   GMC Backend (API) & echo   Port: 3001 & echo =============================== & echo. & node index.js"

REM Start Frontend
timeout /t 2 /nobreak >nul
echo [*] Starting Frontend (Vite)...
cd /d "%PROJECT_DIR%client"
start "GMC-Frontend" cmd /k "cls & echo. & echo =============================== & echo   GMC Frontend (Vite) & echo   Port: 5173 & echo =============================== & echo. & npm run dev"

echo.
timeout /t 5 /nobreak >nul

echo ========================================
echo   GMC System is starting!
echo ========================================
echo.
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo.
echo   Opening browser in 3 seconds...
echo.

timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"

echo [+] Servers running. Close the command windows to stop.
echo.
pause
exit /b 0
