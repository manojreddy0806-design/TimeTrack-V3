#!/bin/bash
# Production startup script for TimeTrack
# Usage: ./start_production.sh

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if virtual environment exists and activate it
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Load environment variables if .env exists
if [ -f "backend/.env" ]; then
    export $(cat backend/.env | grep -v '^#' | xargs)
fi

# Set default MongoDB URI if not set
if [ -z "$MONGO_URI" ]; then
    export MONGO_URI="mongodb://localhost:27017/timetrack"
fi

# Number of workers (adjust based on CPU cores)
WORKERS=${GUNICORN_WORKERS:-8}

# Number of threads per worker
THREADS=${GUNICORN_THREADS:-2}

# Bind address and port
BIND_ADDRESS=${BIND_ADDRESS:-"0.0.0.0:5000"}

echo "Starting TimeTrack with Gunicorn..."
echo "Workers: $WORKERS"
echo "Threads per worker: $THREADS"
echo "Bind: $BIND_ADDRESS"
echo "MongoDB URI: $MONGO_URI"
echo ""

# Start Gunicorn
exec gunicorn \
    -w $WORKERS \
    --threads $THREADS \
    -b $BIND_ADDRESS \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    "backend.app:create_app()"



