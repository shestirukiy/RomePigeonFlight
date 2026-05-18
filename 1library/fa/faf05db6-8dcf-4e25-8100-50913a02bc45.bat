@echo off
chcp 65001 >nul
echo =============================================
echo Build Deployer Tool v1.0.2
echo =============================================
echo.
echo Используйте файл Build-Deployer-config.txt для настройки параметров сборки.
echo Запускаем деплой с текущими настройками...
echo.
powershell -ExecutionPolicy Bypass -Command "& '%~dp0Build-Deployer-v1.0.1.ps1'"
echo.
pause