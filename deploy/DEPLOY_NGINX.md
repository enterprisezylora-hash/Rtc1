# Deploy Hosting Nginx (Ubuntu/Debian)

## 1) Siapkan server

```bash
sudo apt update
sudo apt install -y nginx nodejs npm
```

## 2) Upload project

Taruh project ke:

```bash
/var/www/screen-media-control
```

## 3) Install dependency + build frontend

```bash
cd /var/www/screen-media-control
npm install
npm run build
```

## 4) Isi environment production

```bash
cp .env.server.example .env.server
nano .env.server
```

Isi semua nilai token/secret sesuai milik Anda.

## 5) Pasang service backend (systemd)

```bash
sudo cp deploy/systemd/screen-media-control.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now screen-media-control
sudo systemctl status screen-media-control
```

Jika path node berbeda, ubah `ExecStart` di file service.

## 6) Pasang config Nginx

```bash
sudo cp deploy/nginx/screen-media-control.conf /etc/nginx/sites-available/screen-media-control
sudo ln -sf /etc/nginx/sites-available/screen-media-control /etc/nginx/sites-enabled/screen-media-control
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 7) Cek endpoint

```bash
curl http://127.0.0.1/api/health
```

## 8) HTTPS (opsional, direkomendasikan)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```
