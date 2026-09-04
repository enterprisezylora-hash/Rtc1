# RuoYi-Vue Supabase Setup

Dokumen ini mengaktifkan mode PostgreSQL Supabase untuk backend Java (`ruoyi-admin`) dan mengarahkan frontend UI RuoYi ke API backend.

## 1) Maven dependency (sudah dipatch)

`ruoyi-admin/pom.xml` sekarang memakai driver PostgreSQL:

- `org.postgresql:postgresql`

## 2) Environment variables backend

Set environment sebelum menjalankan `ruoyi-admin`:

```bash
export SUPABASE_DB_URL='jdbc:postgresql://<host>:5432/postgres?sslmode=require'
export SUPABASE_DB_USER='postgres'
export SUPABASE_DB_PASSWORD='<db_password>'

export REDIS_HOST='redis.internal'
export REDIS_PORT='6379'
export REDIS_DATABASE='0'
export REDIS_PASSWORD=''
export REDIS_TIMEOUT='10s'
```

Catatan:

- Gunakan connection string Postgres dari Supabase project settings.
- Jika pakai pooler Supabase, sesuaikan `SUPABASE_DB_URL` ke endpoint pooler.

## 3) Konfigurasi yang sudah disesuaikan

- `ruoyi-admin/src/main/resources/application-druid.yml`
  - driver: `org.postgresql.Driver`
  - datasource master pakai `SUPABASE_DB_*`
  - `validationQuery: SELECT 1`

- `ruoyi-admin/src/main/resources/application.yml`
  - `pagehelper.helperDialect: postgresql`
  - redis config pakai env `REDIS_*`

## 4) Frontend UI

Untuk frontend RuoYi (`ruoyi-ui` terpisah), arahkan base API ke backend Java:

```bash
# .env.development
VUE_APP_BASE_API=http://<backend-host>:8080
```

Jika Anda memakai paket RCO frontend yang sudah dibuat di project lain:

- `screen-media-control/deploy/ruoyi-frontend/src/api/rco/*`
- `screen-media-control/deploy/ruoyi-frontend/src/views/rco/*`

modul itu sudah kompatibel endpoint RuoYi (`/login`, `/getInfo`, `/getRouters`, `/system/rco/*`).
