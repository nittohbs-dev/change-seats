@echo off
rem Old test server (plain Java, no accounts, no live sync). Use start.bat for the current server.
cd /d "%~dp0"
start "" http://localhost:8080
java SeatApp.java
pause
