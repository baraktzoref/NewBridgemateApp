@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo ===================================================
echo   NewBridgemate - יצירת ערב משחק חדש
echo ===================================================
echo.
echo יש לוודא ש"Start Bridge Server" רץ בחלון אחר.
echo.
"%~dp0node.exe" scripts\create-event.mjs --port 8080 --out "%USERPROFILE%\Documents\NewBridgemate"
if errorlevel 1 (
  echo.
  echo יצירת האירוע נכשלה - ראו את השגיאה למעלה.
)
echo.
pause
