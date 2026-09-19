@echo off
rem Starts the Orbis helper and opens the Chromium build with the Orbis side panel.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-orbis-chromium.ps1" %*
