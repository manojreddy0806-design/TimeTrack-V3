# Production Deployment Guide

## Can Multiple Users Login Simultaneously?

**✅ YES!** The application is designed to handle multiple concurrent users:

1. **Client-Side Sessions**: Each user's session is stored in their browser's localStorage, so there are no conflicts
2. **Database**: MongoDB with PyMongo handles concurrent connections natively
3. **Stateless API**: Each API request is independent - no shared state between users

### Supported Concurrent Scenarios:
- ✅ Multiple stores can login at the same time
- ✅ Manager can login while stores are logged in
- ✅ Multiple managers can access (if using same credentials)
- ✅ Employees from different stores can clock in simultaneously
- ✅ Multiple stores can submit EOD reports concurrently

---

## Production Server Setup

### Current Development Setup (Single-Threaded)
The current `app.run(debug=True)` only handles **one request at a time**. For production, you need a proper WSGI server.

### Recommended: Gunicorn

Gunicorn is a production-ready WSGI server that can handle multiple concurrent requests.

#### 1. Install Gunicorn
```bash
pip install gunicorn
```

#### 2. Update requirements-updated.txt
Add `gunicorn` to your requirements file.

#### 3. Run with Gunicorn

**Basic command:**
```bash
cd /path/to/manoj
gunicorn -w 4 -b 0.0.0.0:5000 "backend.app:create_app()"
```

**With more workers (recommended for production):**
```bash
gunicorn -w 8 --threads 2 -b 0.0.0.0:5000 --timeout 120 "backend.app:create_app()"
```

**Explanation:**
- `-w 4`: 4 worker processes (adjust based on CPU cores)
- `--threads 2`: 2 threads per worker (allows handling more concurrent requests)
- `-b 0.0.0.0:5000`: Bind to all interfaces on port 5000
- `--timeout 120`: Request timeout (useful for face recognition uploads)

#### 4. Create a Startup Script (Optional)

Create `start_server.sh`:
```bash
#!/bin/bash
cd /path/to/manoj
source venv/bin/activate  # If using virtual environment
gunicorn -w 8 --threads 2 -b 0.0.0.0:5000 --timeout 120 --access-logfile - --error-logfile - "backend.app:create_app()"
```

Make it executable:
```bash
chmod +x start_server.sh
```

---

## Recommended Production Architecture

### Option 1: Simple Deployment (Single Server)
```
┌─────────────────────────────────┐
│   Nginx (Reverse Proxy)         │
│   - SSL/HTTPS termination       │
│   - Static file serving         │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│   Gunicorn (8 workers)           │
│   - Handles API requests         │
│   - Concurrent request handling  │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│   MongoDB                        │
│   - Handles concurrent queries   │
│   - Connection pooling           │
└──────────────────────────────────┘
```

### Option 2: Scalable Deployment (Multiple Servers)
```
Load Balancer
    │
    ├─► Server 1 (Gunicorn + App)
    ├─► Server 2 (Gunicorn + App)
    └─► Server 3 (Gunicorn + App)
            │
            └─► MongoDB (Replica Set)
```

---

## Nginx Configuration (Recommended)

Create `/etc/nginx/sites-available/timetrack`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS (after SSL setup)
    # return 301 https://$server_name$request_uri;

    # For development, serve directly:
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeouts for face recognition uploads
        proxy_read_timeout 120s;
        proxy_connect_timeout 120s;
    }

    # Serve static files directly (better performance)
    location /static {
        alias /path/to/manoj;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/timetrack /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Performance Considerations

### Concurrent Users Capacity

With Gunicorn (8 workers, 2 threads each):
- **~16 concurrent requests** (8 workers × 2 threads)
- **Typical capacity: 50-100 concurrent users** (requests are fast, users don't constantly make requests)

### Database Connection Pooling

MongoDB with PyMongo automatically handles connection pooling:
- Default: 100 connections per client
- Each Gunicorn worker gets its own connection pool
- MongoDB can handle thousands of concurrent connections

### Scaling Recommendations

**For up to 50 concurrent users:**
- 4-8 Gunicorn workers
- Single MongoDB instance

**For 50-200 concurrent users:**
- 8-16 Gunicorn workers
- MongoDB replica set (primary + secondaries)

**For 200+ concurrent users:**
- Multiple Gunicorn servers behind load balancer
- MongoDB sharded cluster

---

## Environment Variables for Production

Create `.env` file in the project root (same directory as `backend/`):

```env
# MongoDB Connection
MONGO_URI=mongodb://localhost:27017/timetrack
# Or for MongoDB Atlas:
# MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/timetrack

# Flask Secret Key (IMPORTANT: Change this!)
SECRET_KEY=your-super-secret-production-key-here-change-this

# Manager Credentials (IMPORTANT: Change these!)
MANAGER_USERNAME=your-manager-username
MANAGER_PASSWORD=your-secure-manager-password

# Optional: Flask Environment
FLASK_ENV=production
```

**Security Note:** Manager credentials are now stored in environment variables instead of being hardcoded. The application will use the values from your `.env` file, which should NOT be committed to version control.

---

## Monitoring and Logging

### View Gunicorn Logs
```bash
# If running in foreground
gunicorn ... 2>&1 | tee gunicorn.log

# If running as service, check systemd logs
sudo journalctl -u timetrack -f
```

### Health Check Endpoint
The app includes a health check: `GET /api/health`

You can monitor this with:
```bash
curl http://localhost:5000/api/health
```

---

## Security Considerations

1. **Manager Credentials**: Now configured via environment variables
   - ✅ Credentials validated server-side (not in JavaScript)
   - ✅ Set `MANAGER_USERNAME` and `MANAGER_PASSWORD` in `.env` file
   - ⚠️ **IMPORTANT**: Change default credentials in production!
   - 💡 **Future Enhancement**: Consider moving to database with password hashing (bcrypt)

2. **Enable HTTPS**: Use Let's Encrypt for free SSL certificates

3. **CORS Configuration**: Currently allows all origins (`CORS(app)`)
   - Restrict to your domain in production: `CORS(app, origins=["https://yourdomain.com"])`

4. **Session Security**: Currently uses localStorage (client-side)
   - Consider server-side sessions with secure cookies for sensitive data

5. **Environment Variables**: Never commit `.env` file to version control
   - `.gitignore` should include `.env`
   - Use `.env.example` as a template (without actual credentials)

---

## Quick Start Production Deployment

```bash
# 1. Install dependencies
pip install -r requirements-updated.txt
pip install gunicorn

# 2. Set environment variables (or create .env file)
export MONGO_URI="mongodb://localhost:27017/timetrack"
export FLASK_ENV="production"
export MANAGER_USERNAME="your-manager-username"
export MANAGER_PASSWORD="your-secure-manager-password"

# 3. Start with Gunicorn
gunicorn -w 8 --threads 2 -b 0.0.0.0:5000 --timeout 120 "backend.app:create_app()"

# 4. Test
curl http://localhost:5000/api/health
```

---

## Systemd Service (Optional)

Create `/etc/systemd/system/timetrack.service`:

```ini
[Unit]
Description=TimeTrack Application
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/manoj
Environment="PATH=/path/to/venv/bin"
Environment="MONGO_URI=mongodb://localhost:27017/timetrack"
Environment="MANAGER_USERNAME=your-manager-username"
Environment="MANAGER_PASSWORD=your-secure-manager-password"
ExecStart=/path/to/venv/bin/gunicorn -w 8 --threads 2 -b 127.0.0.1:5000 --timeout 120 "backend.app:create_app()"
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable timetrack
sudo systemctl start timetrack
sudo systemctl status timetrack
```

---

## Summary

✅ **Yes, multiple users can login simultaneously!**

**Key Points:**
- Current code supports concurrent logins (client-side sessions, MongoDB connection pooling)
- Use Gunicorn (not Flask dev server) for production
- Start with 8 workers, 2 threads each
- Monitor performance and scale as needed
- Consider Nginx as reverse proxy for better performance and SSL

**Capacity Estimate:**
- Default setup: **50-100 concurrent users** easily
- Can scale to **hundreds** with proper configuration



