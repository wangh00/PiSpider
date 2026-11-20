@echo off
setlocal
cd /d "%~dp0"
node "%~dp0scripts\run-pispider.mjs" %*
exit /b %ERRORLEVEL%
