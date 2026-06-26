# ZKP Zebra – Invoice Tracking Server

Internal web system for Zebra label printers. Records invoice numbers printed by the Android app and provides a web interface for status tracking.

**Status workflow:** Printed → Processing → Ready to pack → Packed → Issued

---

## System overview

```
Android app  ──→  Node.js server (port 3000)  ←──  Browser (web UI)
                          │
                    SQLite database
```

An Nginx Proxy Manager sits in front of the server, forwarding an external domain to the internal port and providing HTTPS.

---

## Installation

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

Verify:
```bash
node --version   # v20.x.x
npm --version    # 10.x.x
```

### 2. Download server files

```bash
mkdir -p /opt/zebra/server
cd /opt/zebra/server
git clone https://github.com/Kruscy/zebra-server.git .
```

### 3. Install dependencies

```bash
npm install
```

### 4. Create systemd service (auto-start)

```bash
nano /etc/systemd/system/zebra-server.service
```

Contents:

```ini
[Unit]
Description=Zebra Invoice Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/zebra/server
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production PORT=3000
Environment=SESSION_SECRET=replace-with-a-random-secret
```

> **Important:** Replace `SESSION_SECRET` with a long random string (e.g. output of `openssl rand -hex 32`).

Enable and start:

```bash
systemctl daemon-reload
systemctl enable zebra-server
systemctl start zebra-server
systemctl status zebra-server
```

### 5. Nginx Proxy Manager setup

Create a new Proxy Host in NPM:

| Field | Value |
|-------|-------|
| Domain Names | your domain |
| Scheme | `http` |
| Forward Hostname | server's internal IP |
| Forward Port | `3000` |
| Websockets Support | enabled |

**SSL:** Request a Let's Encrypt certificate in NPM (Force SSL enabled).

**Advanced tab – custom Nginx config:**

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_connect_timeout 5s;
proxy_next_upstream error timeout http_502 http_503;
proxy_next_upstream_tries 3;
```

---

## Updating

```bash
cd /opt/zebra/server
git pull
npm install
systemctl restart zebra-server
```

---

## API endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /` | – | Web UI (login page) |
| `POST /api/login` | – | Login |
| `POST /api/invoices` | – | Register invoice (Android app) |
| `GET /api/invoices/:num/status` | – | Get invoice status (Android app) |
| `GET /api/invoices` | ✓ | List all invoices |
| `PUT /api/invoices/:id/status` | ✓ | Update invoice status |
| `DELETE /api/invoices/:id` | ✓ | Delete invoice |
| `GET /api/events` | ✓ | SSE real-time updates |
| `GET /api/health` | – | Server health check |

---

## Author

Czebeczauer György – czebeczauer@gmail.com
