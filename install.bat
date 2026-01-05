@echo off
echo Installing dependencies...
npm install
if %ERRORLEVEL% EQU 0 (
    echo Dependencies installed successfully!
    echo You can now run: npm start
) else (
    echo Installation failed!
    pause
)

