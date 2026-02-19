@echo off
chcp 65001 >nul
title Остановка Taxes Sender

echo.
echo ============================================================
echo.
echo              Остановка Taxes Sender
echo.
echo ============================================================
echo.

echo Поиск процесса на порту 3847...
echo.

set FOUND=0

:: Ищем и завершаем процесс node.js на порту 3847
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3847" ^| findstr "LISTENING"') do (
    echo Найден процесс: %%a
    taskkill /F /PID %%a >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] Процесс %%a успешно остановлен
        set FOUND=1
    ) else (
        echo [!] Не удалось остановить процесс %%a
    )
)

:: Также завершаем все процессы node с нашим скриптом
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Taxes Sender*" >nul 2>&1

if %FOUND% equ 0 (
    echo.
    echo [!] Процесс не найден — сервер уже остановлен
) else (
    echo.
    echo [OK] Taxes Sender остановлен
)

echo.
echo Нажмите любую клавишу для выхода...
pause >nul
