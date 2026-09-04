# RuoYi Supabase Setup

Dokumen ini mengaktifkan mode PostgreSQL Supabase untuk backend Java (`ruoyi-admin`).

## 1) Maven dependency (sudah dipatch)

`ruoyi-admin/pom.xml` sekarang memakai driver PostgreSQL:

- `org.postgresql:postgresql`

## 2) Environment variables backend

Set environment sebelum menjalankan aplikasi:

```bash
export SUPABASE_DB_URL='jdbc:postgresql://<host>:5432/postgres?sslmode=require'
export SUPABASE_DB_USER='postgres'
export SUPABASE_DB_PASSWORD='<db_password>'
```

Jika butuh slave:

```bash
export SUPABASE_DB_SLAVE_URL=''
export SUPABASE_DB_SLAVE_USER=''
export SUPABASE_DB_SLAVE_PASSWORD=''
```

## 3) Konfigurasi yang disesuaikan

- `ruoyi-admin/src/main/resources/application-druid.yml`
  - driver: `org.postgresql.Driver`
  - datasource master pakai `SUPABASE_DB_*`
  - `validationQuery: SELECT 1`

- `ruoyi-admin/src/main/resources/application.yml`
  - `pagehelper.helperDialect: postgresql`

## 4) Jalankan

```bash
mvn -pl ruoyi-admin -am -DskipTests clean package
```
