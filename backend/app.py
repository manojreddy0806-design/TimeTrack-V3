# backend/app_updated.py
# This will replace backend/app.py after reorganization
# Copy this to backend/app.py after running reorganize_safe.py

from flask import Flask, send_from_directory, jsonify
from flask_pymongo import PyMongo
from flask_cors import CORS
import click
import sys
import os
from pathlib import Path

# If this module is executed directly (python backend/app.py), the
# import system will set sys.path[0] to the `backend/` directory which
# prevents importing the `backend` package using absolute imports
# like `backend.config`. Insert the project root into sys.path when
# running as a script so absolute imports work.
if __package__ is None:
    project_root = str(Path(__file__).resolve().parent.parent)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

from backend.config import Config

mongo = PyMongo()

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    CORS(app)

    mongo.init_app(app)

    from backend.routes.employees import bp as employees_bp
    from backend.routes.timeclock import bp as timeclock_bp
    from backend.routes.inventory import bp as inventory_bp
    from backend.routes.eod import bp as eod_bp
    from backend.routes.stores import bp as stores_bp
    from backend.routes.face import bp as face_bp
    from backend.routes.inventory_history import bp as inventory_history_bp

    # Register blueprints - order matters! More specific routes first
    app.register_blueprint(inventory_history_bp, url_prefix="/api/inventory/history")
    app.register_blueprint(employees_bp, url_prefix="/api/employees")
    app.register_blueprint(timeclock_bp, url_prefix="/api/timeclock")
    app.register_blueprint(inventory_bp, url_prefix="/api/inventory")
    app.register_blueprint(eod_bp, url_prefix="/api/eod")
    app.register_blueprint(stores_bp, url_prefix="/api/stores")
    app.register_blueprint(face_bp, url_prefix="/api/face")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}
    
    # Debug routes removed for production security
    # To enable debug routes, only do so in development environment
    import os
    if os.getenv("FLASK_ENV") == "development":
        @app.get("/api/debug/routes")
        def debug_routes():
            routes = []
            for rule in app.url_map.iter_rules():
                routes.append({
                    "endpoint": rule.endpoint,
                    "methods": list(rule.methods),
                    "rule": str(rule)
                })
            return jsonify({"routes": routes})

    # Project root path
    project_root = Path(__file__).resolve().parent.parent
    frontend_pages = project_root / "frontend" / "pages"
    frontend_static = project_root / "frontend" / "static"

    # Serve index.html from frontend/pages
    @app.get("/")
    def serve_index():
        return send_from_directory(frontend_pages, "index.html")

    # Serve HTML pages from frontend/pages
    @app.get("/<path:page>.html")
    def serve_page(page):
        return send_from_directory(frontend_pages, f"{page}.html")

    # Serve static CSS files
    @app.get("/static/css/<path:filename>")
    def serve_css(filename):
        return send_from_directory(frontend_static / "css", filename)

    # Serve static JS files
    @app.get("/static/js/<path:filename>")
    def serve_js(filename):
        return send_from_directory(frontend_static / "js", filename)

    # Fallback: serve any other files from frontend/pages (for backward compatibility)
    # Exclude API routes from catch-all
    @app.get("/<path:path>")
    def serve_static(path):
        # Don't interfere with API routes
        if path.startswith('api/'):
            from flask import abort
            abort(404)
        # Try frontend/pages first (for any remaining HTML)
        if path.endswith('.html'):
            return send_from_directory(frontend_pages, path)
        # Otherwise, try static folders
        if path.startswith('static/'):
            return send_from_directory(frontend_static, path[7:])  # Remove 'static/' prefix
        # Fallback to frontend/pages
        return send_from_directory(frontend_pages, path)

    # CLI command to seed default stores
    @app.cli.command("seed-stores")
    def seed_stores_command(): 
        stores = mongo.db.stores
        if stores.count_documents({}) == 0:
            stores.insert_many([
                {"name": "Lawrence"},
                {"name": "Oakville"}
            ])
            click.echo("Seeded default stores: Lawrence, Oakville")
        else:
            click.echo("Stores already exist; skipping seed")

    return app

if __name__ == "__main__":
    app = create_app()
    # Only run in debug mode if explicitly set in environment
    debug_mode = os.getenv("FLASK_DEBUG", "False").lower() == "true"
    app.run(debug=debug_mode)

