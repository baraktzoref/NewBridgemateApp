@echo off
setlocal
chcp 65001 >nul
echo ===================================================
echo   NewBridgemateApp - יצירת ערב משחק חדש
echo ===================================================
echo.
echo חשוב: יש להשאיר את windows\start-server.bat פתוח
echo ורץ בחלון אחר, לפני שמריצים את הקובץ הזה.
echo.

cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo שגיאה: לא נמצא Node.js. יש להפעיל קודם את windows\install.bat
  pause
  exit /b 1
)

echo יתבקשו שם הערב, מספר הזוגות, ומספר הלוחות לסיבוב.
echo לאחר היצירה, ייפתח בדפדפן גיליון הדפסה עם כתובת לכל שולחן,
echo קוד האירוע, וה-PIN החד-פעמי של המנהל - יש לשמור/להדפיס אותו!
echo.

node scripts\create-event.mjs --port 8080
if errorlevel 1 (
  echo.
  echo יצירת האירוע נכשלה - ראו את השגיאה שלמעלה.
  echo הסיבה הנפוצה: windows\start-server.bat לא רץ, או שה-port שונה.
)

echo.
pause
