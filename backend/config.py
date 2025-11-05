import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

class Config:
    BASE_DIR = Path(__file__).resolve().parent.parent  # project root
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{BASE_DIR / 'timetrack.db'}"  # default: SQLite file
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-key")
    MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017/timetrack')
    
    # Manager credentials (should be set via environment variables in production)
    MANAGER_USERNAME = os.getenv('MANAGER_USERNAME', 'manager')
    MANAGER_PASSWORD = os.getenv('MANAGER_PASSWORD', 'mgr123')