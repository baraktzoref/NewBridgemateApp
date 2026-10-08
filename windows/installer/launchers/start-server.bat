@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo ===================================================
echo   NewBridgemate - הפעלת השרת
echo ===================================================
echo.
echo כתובות הרשת של המחשב (הטלפונים צריכים את כתובת ה-IPv4
echo של רשת ה-WiFi, ולא localhost):
ipconfig | findstr /i "IPv4"
echo.
echo להשאיר את החלון הזה פתוח כל הערב. לעצירה: Ctrl+C.
echo.
if not exist "%PROGRAMDATA%\NewBridgemate" mkdir "%PROGRAMDATA%\NewBridgemate"
set PORT=8080
set DB_PATH=%PROGRAMDATA%\NewBridgemate\bridge.sqlite
"%~dp0node.exe" --experimental-strip-types --experimental-sqlite packages\api\src\main.ts
echo.
echo השרת נעצר.
pause
