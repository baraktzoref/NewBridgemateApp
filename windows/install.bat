@echo off
setlocal
chcp 65001 >nul
echo ===================================================
echo   NewBridgemateApp - התקנה למחשב Windows
echo ===================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo שגיאה: לא נמצא Node.js במחשב הזה.
  echo.
  echo יש להתקין קודם Node.js גרסה 22.5 ומעלה מהכתובת:
  echo   https://nodejs.org
  echo לאחר ההתקנה, יש להפעיל מחדש את הקובץ הזה.
  echo.
  pause
  exit /b 1
)

echo נמצא Node.js, בודק גרסה...
node -v
echo.

rem windows\install.bat נמצא תחת תיקיית windows של הפרויקט - עוברים לתיקיית השורש
cd /d "%~dp0.."

echo מתקין חבילות (npm install), זה עלול לקחת כמה דקות בפעם הראשונה...
call npm install
if errorlevel 1 (
  echo.
  echo ההתקנה נכשלה. יש להעביר את הפלט שלמעלה למי שתומך בפרויקט.
  pause
  exit /b 1
)

echo.
echo ===================================================
echo   ההתקנה הסתיימה בהצלחה!
echo   השלב הבא: הפעילו את windows\start-server.bat
echo ===================================================
pause
