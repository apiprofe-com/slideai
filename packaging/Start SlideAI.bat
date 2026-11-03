@echo off
rem SlideAI launcher: no install, no admin. Double-click to start.
cd /d "%~dp0"
title SlideAI (works with JSTOR Images)
"%~dp0node\node.exe" "%~dp0app\src\cli.js" new
echo.
echo Press any key to close this window.
pause >nul
