@echo off
echo ========================================
echo Initial Setup - Push to GitHub
echo ========================================
echo.
echo This script will push both Kolkata and AHM UIs to GitHub
echo.
echo Repositories:
echo   - Kolkata: https://github.com/eacdc/grn-ui-kolkata.git
echo   - AHM:     https://github.com/eacdc/grn-ui-ahm.git
echo.
pause

REM ====================================
REM Setup Kolkata Repository
REM ====================================
echo.
echo ========================================
echo Setting up Kolkata UI
echo ========================================
cd /d "%~dp0kolkata"

echo Initializing git...
git init

echo Adding all files...
git add .

echo Committing...
git commit -m "Initial commit - Kolkata GRN UI"

echo Adding remote...
git remote add origin https://github.com/eacdc/grn-ui-kolkata.git

echo Setting branch to main...
git branch -M main

echo Pushing to GitHub...
git push -u origin main

echo.
echo Kolkata UI pushed successfully!
echo.

REM ====================================
REM Setup AHM Repository
REM ====================================
echo.
echo ========================================
echo Setting up AHM UI
echo ========================================
cd /d "%~dp0ahm"

echo Initializing git...
git init

echo Adding all files...
git add .

echo Committing...
git commit -m "Initial commit - AHM GRN UI"

echo Adding remote...
git remote add origin https://github.com/eacdc/grn-ui-ahm.git

echo Setting branch to main...
git branch -M main

echo Pushing to GitHub...
git push -u origin main

echo.
echo AHM UI pushed successfully!
echo.

REM ====================================
REM Complete
REM ====================================
echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Both repositories have been pushed to GitHub:
echo   - Kolkata: https://github.com/eacdc/grn-ui-kolkata
echo   - AHM:     https://github.com/eacdc/grn-ui-ahm
echo.
echo Next Steps:
echo   1. Go to https://dashboard.render.com/
echo   2. Create a new Static Site for each repository
echo   3. Configure as described in DEPLOY_TO_GITHUB.md
echo.
echo ========================================
echo.

pause

