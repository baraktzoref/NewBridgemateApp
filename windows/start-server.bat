@echo off
setlocal
chcp 65001 >nul
echo ===================================================
echo   NewBridgemateApp - הפעלת השרת
echo ===================================================
echo.

cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo שגיאה: לא נמצא Node.js. יש להפעיל קודם את windows\install.bat
  pause
  exit /b 1
)

echo כתובות הרשת של המחשב הזה (אחת מהן - זו שבה הטלפונים צריכים
echo להשתמש, בתנאי שהם מחוברים לאותה רשת WiFi):
echo.
ipconfig | findstr /i "IPv4"
echo.
echo אם תופיע התראה של חומת האש של Windows (Windows Defender
echo Firewall) - יש לאשר גישה (Allow access), אחרת הטלפונים לא
echo יוכלו להתחבר.
echo.
echo השרת יעלה על פורט 8080. להשארת החלון הזה פתוח כל הערב!
echo לסגירת השרת: Ctrl+C בחלון הזה.
echo.

cd packages\api
set PORT=8080
set DB_PATH=./bridge.sqlite
call npm start
pause
