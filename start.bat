@echo off
echo =========================================
echo   KiramoPay - Starting all services...
echo =========================================
echo.

docker compose up --build -d
if %ERRORLEVEL% neq 0 (
    echo [!] Failed to start Docker services.
    echo     Make sure Docker Desktop is running.
    pause
    exit /b 1
)

echo.
echo Waiting for services to be healthy...

set RETRY=0
set MAX_RETRIES=30

:WAIT_LOOP
curl -sf http://localhost:9999/health >nul 2>&1
if %ERRORLEVEL% equ 0 goto READY

set /a RETRY+=1
if %RETRY% geq %MAX_RETRIES% (
    echo.
    echo [!] Timeout waiting for services. Check logs with:
    echo     docker compose logs
    pause
    exit /b 1
)

<nul set /p =.
timeout /t 2 /nobreak >nul
goto WAIT_LOOP

:READY
echo.
echo.
echo =========================================
echo   KiramoPay is running!
echo =========================================
echo.
echo   App:       http://localhost:9999
echo   API:       http://localhost:9999/api/v1/
echo   Health:    http://localhost:9999/health
echo   WebSocket: ws://localhost:9999/ws/prices
echo.
echo   Test users:
echo     Keilor  -^> 702650930 / Kiramopay2024!
echo     Admin   -^> 700000000 / Admin2024!
echo.
echo   Commands:
echo     docker compose logs -f       View logs
echo     docker compose down          Stop all
echo     docker compose down -v       Stop + delete data
echo =========================================
echo.
pause
