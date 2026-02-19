@echo off
chcp 65001 >nul
title Taxes Sender

if exist "%~dp0node\node.exe" (
    set "PATH=%~dp0node;%PATH%"
    goto :start
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js не найден!
    echo.
    echo     Установите Node.js: https://nodejs.org/
    echo     или запустите download-node.bat
    echo.
    pause >nul
    exit /b 1
)

:start
cd /d "%~dp0"
node server/index.js

if %errorlevel% neq 0 (
    echo.
    echo [ОШИБКА] Сервер остановился с кодом: %errorlevel%
    echo.
    pause >nul
)
