@echo off
chcp 65001 >nul
title Перезапуск Taxes Sender

echo.
echo ============================================================
echo.
echo             Перезапуск Taxes Sender
echo.
echo ============================================================
echo.

echo Остановка текущего процесса...
echo.

:: Ищем и завершаем процесс node.js на порту 3847
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3847" ^| findstr "LISTENING"') do (
    echo Остановка процесса %%a...
    taskkill /F /PID %%a >nul 2>&1
)

:: Также завершаем все процессы node с нашим скриптом
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Taxes Sender*" >nul 2>&1

echo.
echo Ожидание освобождения порта...
timeout /t 2 /nobreak >nul

echo.
echo Запуск сервера заново...
echo.
echo ============================================================
echo.

:: Запускаем start.bat
call "%~dp0start.bat"
