@echo off
chcp 65001 >nul
cd /d D:\opencode\godseye-industrial
echo [PICT INDUSTRIAL] single port 3200 (API + web UI)
if not exist dist\index.html (
  echo dist not found - building frontend (1-2 min)...
  call npm run build
)
start "godseye-industrial" cmd /k "set PORT=3200&& node server\index.js"
timeout /t 4 >nul
start http://localhost:3200/
