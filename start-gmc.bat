@echo off
title GMC System — Start Servers

echo Starting GMC backend (API)...
start "GMC Backend" /MIN cmd /c "node C:\Users\wagne\.claude\projects\GMC - System\server\index.js"

timeout /t 2 /nobreak >nul

echo Starting GMC frontend (Vite)...
start "GMC Frontend" /MIN cmd /c "cd /d C:\Users\wagne\.claude\projects\GMC - System\client && npm run dev"

timeout /t 4 /nobreak >nul

echo.
echo ========================================
echo  GMC System is running!
echo  Abrindo http://localhost:5173 ...
echo ========================================
echo.

start "" "http://localhost:5173"

echo Feche esta janela para parar os servidores.
pause
