@echo off
setlocal
cd /d "%~dp0"
title REQUIEM ATLAS - Launcher
color 0D
echo.
echo  ================================================
echo             REQUIEM ATLAS  ^|  v0.1.0
echo  ================================================
echo.
where py >nul 2>&1
if %errorlevel%==0 (
  set "PYTHON=py -3"
) else (
  where python >nul 2>&1
  if errorlevel 1 goto :no_python
  set "PYTHON=python"
)
where npm >nul 2>&1
if errorlevel 1 goto :no_node
if not exist "backend\.venv\Scripts\python.exe" (
  echo [1/4] Creating Python virtual environment...
  cd backend
  %PYTHON% -m venv .venv
  if errorlevel 1 goto :install_error
  cd ..
)
echo [2/4] Installing Python packages (first launch may take a while)...
"backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 goto :install_error
if not exist "frontend\node_modules" (
  echo [3/4] Installing frontend dependencies...
  cd frontend
  call npm install
  if errorlevel 1 goto :install_error
  cd ..
) else (
  echo [3/4] Frontend dependencies available.
)
echo [4/4] Launching two local servers...
start "ATLAS API - keep open" /D "%~dp0backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
start "ATLAS UI - keep open" /D "%~dp0frontend" cmd /k "npm run dev"
timeout /t 5 /nobreak >nul
start "" "http://127.0.0.1:5173"
echo.
echo Open this URL: http://127.0.0.1:5173
echo API docs:      http://127.0.0.1:8000/docs
echo Close the two server windows to stop the application.
echo.
pause
exit /b 0
:no_python
echo ERROR: Python was not found. Install Python 3.11+ from python.org.
pause
exit /b 1
:no_node
echo ERROR: npm not found. Install Node.js 22 LTS from nodejs.org.
pause
exit /b 1
:install_error
echo ERROR during setup. Check internet connection and errors above.
pause
exit /b 1
