# ZKP Zebra – Számlakezelő szerver

Belső webes rendszer Zebra nyomtatókhoz. Az Android app által nyomtatott számlaszámokat rögzíti, és webes felületen teszi lehetővé a státuszkövetést és szállítókezelést.

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

## Funkciók

- Számlarögzítés az Android appból (szállítóval együtt)
- Számla státuszkövetés webes felületen
- Szállítókezelés (név, logókép, megjelenítési mód: szöveg / szöveg+kép / csak kép)
- Vízszintesen görgethető szállítószűrő chipek
- Valós idejű frissítés SSE (Server-Sent Events) segítségével
- APK letöltés közvetlenül a webes felületről (bejelentkezés után)
- Bejelentkezési kísérlet-korlátozás (max 10 kísérlet / 15 perc / IP)
- Content Security Policy fejlécek

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

### 5. Első bejelentkezés

Az első indításkor a szerver automatikusan létrehozza az alapértelmezett adminisztrátort. Bejelentkezés után azonnal változtasd meg a jelszót: jobb felső sarok → **Jelszóváltás**.

### 6. Nginx Proxy Manager beállítása

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
proxy_cache off;
proxy_set_header X-Accel-Buffering no;
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
| `POST /api/logout` | – | Kijelentkezés |
| `GET /api/me` | – | Session ellenőrzés |
| `POST /api/change-password` | ✓ | Jelszóváltás |
| `GET /api/health` | – | Szerver állapot |
| `GET /api/events` | ✓ | SSE valós idejű frissítés |
| `POST /api/invoices` | – | Számla rögzítése (Android app) |
| `GET /api/invoices` | ✓ | Összes számla listája |
| `GET /api/invoices/:num/status` | – | Státusz lekérdezése (Android app) |
| `PUT /api/invoices/:id/status` | ✓ | Státusz módosítása |
| `DELETE /api/invoices/:id` | ✓ | Számla törlése |
| `GET /api/suppliers` | – | Szállítók listája (Android app) |
| `POST /api/suppliers` | – | Szállító létrehozása (Android app) |
| `PUT /api/suppliers/:id` | ✓ | Szállító szerkesztése (web) |
| `DELETE /api/suppliers/:id` | ✓ | Szállító törlése (web) |

---

## Android alkalmazás

A ZebraPrint Android app a webes felületről tölthető le bejelentkezés után.

- Számlacímkét és QR kódot nyomtat Zebra ZQ310/ZQ320 (72mm) és ZD230d (102mm) nyomtatókra
- Számlát rögzít a szerveren az API-n keresztül
- Szállítót lehet kiválasztani nyomtatáskor
- TCP nyomtatás a 9100-as porton

---

## Fejlesztő

Czebeczauer György egyéni vállalkozó – czebeczauer@gmail.com
