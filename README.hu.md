# ZKP Zebra – Számlakezelő szerver

Belső webes rendszer Zebra nyomtatókhoz. Az Android app által nyomtatott számlaszámokat rögzíti, és egy webes felületen teszi lehetővé a státuszkövetést.

**Státusz folyamat:** Nyomtatva → Feldolgozás alatt → Elpakolható → Elpakolva → Kiadva

---

## Rendszer áttekintése

```
Android app  ──→  Node.js szerver (port 3000)  ←──  Böngésző (web UI)
                          │
                    SQLite adatbázis
```

A szerver elé Nginx Proxy Manager kerül, amely a külső domain-t továbbítja a belső portra és HTTPS-t biztosít.

---

## Telepítés

### 1. Node.js telepítése

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

Ellenőrzés:
```bash
node --version   # v20.x.x
npm --version    # 10.x.x
```

### 2. Szerver fájlok letöltése

```bash
mkdir -p /opt/zebra/server
cd /opt/zebra/server
git clone https://github.com/Kruscy/zebra-server.git .
```

### 3. Függőségek telepítése

```bash
npm install
```

### 4. Systemd service létrehozása (automatikus indítás)

```bash
nano /etc/systemd/system/zebra-server.service
```

Tartalom:

```ini
[Unit]
Description=Zebra Számlakezelő szerver
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/zebra/server
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production PORT=3000
Environment=SESSION_SECRET=ide-irj-egy-titkos-szot
```

> **Fontos:** a `SESSION_SECRET` értékét cseréld le egy véletlenszerű, hosszú szövegre (pl. `openssl rand -hex 32` kimenetére).

Service aktiválása:

```bash
systemctl daemon-reload
systemctl enable zebra-server
systemctl start zebra-server
systemctl status zebra-server
```

### 5. Nginx Proxy Manager beállítása

Az NPM-ben hozz létre egy új Proxy Host-ot:

| Mező | Érték |
|------|-------|
| Domain Names | saját domain |
| Scheme | `http` |
| Forward Hostname | a szerver belső IP-je |
| Forward Port | `3000` |
| Websockets Support | be |

**SSL:** Let's Encrypt tanúsítvány kérése az NPM-ben (Force SSL bekapcsolva).

**Advanced tab – custom Nginx config:**

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_connect_timeout 5s;
proxy_next_upstream error timeout http_502 http_503;
proxy_next_upstream_tries 3;
```

---

## Frissítés

```bash
cd /opt/zebra/server
git pull
npm install
systemctl restart zebra-server
```

---

## API végpontok

| Végpont | Auth | Leírás |
|---------|------|--------|
| `GET /` | – | Web felület (login oldal) |
| `POST /api/login` | – | Bejelentkezés |
| `POST /api/invoices` | – | Számla rögzítése (Android app) |
| `GET /api/invoices/:num/status` | – | Státusz lekérdezése (Android app) |
| `GET /api/invoices` | ✓ | Összes számla listája |
| `PUT /api/invoices/:id/status` | ✓ | Státusz módosítása |
| `DELETE /api/invoices/:id` | ✓ | Számla törlése |
| `GET /api/events` | ✓ | SSE real-time frissítés |
| `GET /api/health` | – | Szerver állapot |

---

## Fejlesztő

Czebeczauer György egyéni vállalkozó – czebeczauer@gmail.com
