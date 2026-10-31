@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title REQUIEM ATLAS - Publish on GitHub
color 0D

echo.
echo  ================================================
echo       REQUIEM ATLAS - GITHUB PUBLISHER
 echo  ================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git for Windows not found.
  echo Install: https://git-scm.com/downloads/win
  goto :failed
)
where gh >nul 2>&1
if errorlevel 1 (
  echo [ERROR] GitHub CLI not found.
  echo Install: https://cli.github.com/
  goto :failed
)

 echo [1/5] Checking GitHub login...
gh auth status >nul 2>&1
if errorlevel 1 (
 echo You are not signed into GitHub CLI.
 echo A browser-based login will begin. Follow the prompts.
 gh auth login --web --git-protocol https
 if errorlevel 1 goto :failed
)

for /f "usebackq delims=" %%U in (`gh api user --jq .login`) do set "GH_LOGIN=%%U"
if /i not "!GH_LOGIN!"=="requiembby" (
 echo [ERROR] Signed in as !GH_LOGIN! instead of requiembby.
 echo Use: gh auth switch
 goto :failed
)

 echo [2/5] Preparing local Git repository...
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
 git init -b main
 if errorlevel 1 goto :failed
)

git config user.name >nul 2>&1
if errorlevel 1 git config user.name "requiembby"
git config user.email >nul 2>&1
if errorlevel 1 (
  for /f "usebackq delims=" %%I in (`gh api user --jq .id`) do set "GH_ID=%%I"
  if not defined GH_ID goto :failed
  git config user.email "!GH_ID!+requiembby@users.noreply.github.com"
)

echo [3/5] Creating the initial commit...
git add .
if errorlevel 1 goto :failed
git diff --cached --quiet
if errorlevel 1 (
 git commit -m "Initial release: Requiem Atlas v0.1"
 if errorlevel 1 goto :failed
) else (
 echo No new files to commit.
)

echo [4/5] Publishing to GitHub...
gh repo view requiembby/requiem-atlas >nul 2>&1
if errorlevel 1 (
 gh repo create requiembby/requiem-atlas --public --description "Local-first OSINT platform for exploring public internet infrastructure with React and FastAPI" --source . --remote origin --push
 if errorlevel 1 goto :failed
) else (
 echo Existing repo detected. Checking origin...
 git remote get-url origin >nul 2>&1
 if errorlevel 1 git remote add origin https://github.com/requiembby/requiem-atlas.git
 git push -u origin HEAD
 if errorlevel 1 goto :failed
)

echo [5/5] Repository is published!
echo https://github.com/requiembby/requiem-atlas
start "" "https://github.com/requiembby/requiem-atlas"
echo.
pause
exit /b 0

:failed
echo.
echo Publishing did not complete. Read the error above.
echo No passwords or access tokens should be pasted into this script.
pause
exit /b 1
