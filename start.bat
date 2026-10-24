@echo off
rem Starts the seat app (Spring Boot). Logic and messages are in tools\start.ps1 (this file is ASCII only on purpose).
rem   start.bat           ... start
rem   start.bat rebuild   ... rebuild the program, then start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start.ps1" %*
pause
