"""
Vercel serverless function entry point for Flask application
"""
from backend.app import create_app

# Create the Flask app instance
app = create_app()

# Export the app for Vercel to use as a WSGI handler
# Vercel will automatically detect and use this app object
__all__ = ['app']


