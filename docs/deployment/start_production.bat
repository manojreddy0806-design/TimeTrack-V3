@echo off
REM Production startup script for TimeTrack (Windows)
REM Usage: start_production.bat

REM Get the directory where this script is located
cd /d "%~dp0"

REM Check if virtual environment exists and activate it
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

REM Load environment variables from .env if it exists
if exist "backend\.env" (
    for /f "tokens=1,2 delims==" %%a in (backend\.env) do (
        if not "%%a"=="" if not "%%a"=="#" set "%%a=%%b"
    )
)

REM Set default MongoDB URI if not set
if "%MONGO_URI%"=="" (
    set MONGO_URI=mongodb://localhost:27017/timetrack
)

REM Number of workers (adjust based on CPU cores)
if "%GUNICORN_WORKERS%"=="" (
    set GUNICORN_WORKERS=8
)

REM Number of threads per worker
if "%GUNICORN_THREADS%"=="" (
    set GUNICORN_THREADS=2
)

REM Bind address and port
if "%BIND_ADDRESS%"=="" (
    set BIND_ADDRESS=0.0.0.0:5000
)

echo Starting TimeTrack with Gunicorn...
echo Workers: %GUNICORN_WORKERS%
echo Threads per worker: %GUNICORN_THREADS%
echo Bind: %BIND_ADDRESS%
echo MongoDB URI: %MONGO_URI%
echo.

REM Start Gunicorn
gunicorn -w %GUNICORN_WORKERS% --threads %GUNICORN_THREADS% -b %BIND_ADDRESS% --timeout 120 --access-logfile - --error-logfile - --log-level info "backend.app:create_app()"



