# Screen Media Control Panel

Admin panel berbasis Vue + control server berbasis Express/WebSocket untuk:
- monitor client screen device
- kirim command screen on/off/lock/unlock
- upload media
- play/stop media broadcast
- lihat live activity

## Menjalankan

1. Install dependency:

```bash
npm install
```

2. Jalankan frontend + backend bersamaan:

```bash
npm run dev
```

Frontend: http://localhost:5173
Backend API: http://localhost:8787
WebSocket: ws://localhost:8787/ws

## Login Admin

- Default (dev): `admin / admin123`
- Token JWT didapat dari endpoint `POST /api/auth/login`
- Endpoint `/api/*` selain health/login butuh `Authorization: Bearer <token>`

## RuoYi Access Control (Custom Full)

Backend sudah mengikuti permission model ala RuoYi:

- role -> permission matrix (`admin`, `operator`, `viewer`)
- `GET /getInfo` mengembalikan permission sesuai role
- route metadata `/getRouters` menyertakan permission modul
- endpoint `/system/rco/*` memakai guard permission (`requirePermi`)

## Persistence

- Mode aktif saat ini: Supabase-first (Postgres + Realtime + Storage)
- Tabel inti: `users`, `clients`, `media`, `activity`, `schedules`
- Tabel queue command: `rco_devices`, `rco_commands`, `rco_command_logs`
- SQLite local sudah dihapus dari runtime dependency.

## Redis Engine Layer

Redis dipakai untuk mode multi-instance backend:


Environment Redis:


## Dual-instance Redis verification

Jalankan test otomatis untuk verifikasi pub/sub lintas instance backend:

```bash
npm run test:redis:dual
```

Yang diverifikasi test:

- start 2 instance backend dengan `INSTANCE_ID` berbeda
- login ke instance A
- register dummy client di instance A
- kirim command `POST /system/rco/task` dari instance A
- pastikan instance B menerima event websocket `rco-status` dari Redis channel (dengan `instanceId` milik instance A)
- cek `GET /api/redis/queue-stats` di kedua instance dalam mode `ready=true`

Override opsional:

- `TEST_PORT_A` (default `8891`)
- `TEST_PORT_B` (default `8892`)
- `TEST_USERNAME` / `TEST_PASSWORD` (default mengikuti admin env atau `admin/admin123`)
- `TEST_EVENT_TIMEOUT_MS` (default `15000`)
- `TEST_START_MAX_RETRY` (default `4`, retry startup saat init Supabase transient error)

## Playback Scheduler

- Buat jadwal dari tab `Scheduler`
- Mode: `once` dan `daily`
- Scheduler engine berjalan setiap 5 detik di backend

## Token-based Environment

Frontend env: copy `.env.example` ke `.env`.
Backend env: copy `.env.server.example` ke `.env.server`.

## Supabase S3 Upload

- Upload media akan langsung ke Supabase S3 jika env ini terisi lengkap:
	- `SUPABASE_STORAGE_S3_ENDPOINT`
	- `SUPABASE_STORAGE_REGION`
	- `SUPABASE_STORAGE_ACCESS_KEY`
	- `SUPABASE_STORAGE_SECRET_KEY`
	- `SUPABASE_STORAGE_BUCKET`
- Jika belum lengkap, server otomatis fallback ke local storage `server/uploads`.

## Supabase SQL (Core + RCO)

Untuk runtime Supabase-only, jalankan SQL ini secara berurutan:

1. `supabase/sql/core_schema.sql`
2. `supabase/sql/rco_schema.sql`
3. `supabase/sql/rco_realtime.sql`

Contoh via Supabase CLI:

```bash
supabase db query --linked --file supabase/sql/core_schema.sql
supabase db query --linked --file supabase/sql/rco_schema.sql
supabase db query --linked --file supabase/sql/rco_realtime.sql
```

## Supabase SQL RCO

Skema SQL RCO untuk Supabase ada di file berikut:

- `supabase/sql/rco_schema.sql`

Cara pakai cepat:

1. Buka Supabase Dashboard -> SQL Editor.
2. Copy seluruh isi `supabase/sql/rco_schema.sql` lalu jalankan.
3. Verifikasi tabel terbentuk:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
	and table_name in ('rco_devices', 'rco_commands', 'rco_command_logs');
```

4. Uji insert device dan command:

```sql
insert into public.rco_devices (external_device_id, display_name)
values ('device-001', 'Test Device')
on conflict (external_device_id) do nothing;

insert into public.rco_commands (device_id, command_type, payload)
select id, 'open_web', '{"url":"https://example.com"}'::jsonb
from public.rco_devices
where external_device_id = 'device-001';
```

## WebSocket

### 1) WebSocket backend yang sudah aktif saat ini

- URL: `ws://<host>:8787/ws?token=<JWT>`
- Jika via Nginx HTTPS: `wss://<domain>/ws?token=<JWT>`
- Handler ada di `server/index.js` pada `new WebSocketServer({ path: '/ws' })`.

Event utama yang dikirim server:

- `snapshot`
- `activity`
- `command`
- `health`
- `error`

Contoh payload ping dari client:

```json
{ "type": "ping" }
```

### 2) WebSocket untuk SQL RCO via Supabase Realtime

Jika Anda mau command RCO dari tabel Supabase langsung realtime, jalankan file:

- `supabase/sql/rco_realtime.sql`

Lalu subscribe dari client/device (supabase-js):

```js
const channel = supabase
	.channel('rco-commands')
	.on(
		'postgres_changes',
		{ event: 'INSERT', schema: 'public', table: 'rco_commands' },
		(payload) => {
			console.log('new command', payload.new)
		}
	)
	.subscribe()
```

### 3) Wiring backend -> rco_commands (sudah aktif)

Endpoint panel berikut sekarang otomatis enqueue command ke tabel `public.rco_commands`:

- `POST /api/control/screen`
- `POST /api/control/media/play`
- `POST /api/control/media/stop`
- `POST /api/control/task/preset/:key` (one-click preset task)
- `POST /api/control/task` (raw APK task by numeric `type`)

Mapping device dilakukan via `external_device_id = client.id` ke tabel `public.rco_devices`.
Jika device belum ada, backend akan auto-upsert device dulu sebelum insert command.

Response endpoint command sekarang menyertakan field `rcoQueued` untuk jumlah command yang berhasil di-queue ke Supabase.

### 4) Subscriber device realtime (Node.js)

File subscriber:

- `server/rco-device-subscriber.js`

Script run:

```bash
npm run rco:subscriber
```

Atau mode dev:

```bash
npm run dev:rco-device
```

Subscriber akan:

1. upsert row device ke `rco_devices`
2. subscribe realtime `INSERT` tabel `rco_commands` untuk device_id terkait
3. update status command `sent -> acked`
4. insert jejak lifecycle ke `rco_command_logs`

## Environment Optional

Supabase di project ini dipakai untuk:

- database (`rco_devices`, `rco_commands`, dst)
- storage upload media
- realtime command channel

Frontend panel tetap memanggil endpoint server API (`/api/*`) dari backend `server/index.js`.
Artinya, `VITE_API_BASE` harus menunjuk ke URL backend kamu (bukan `https://<project>.supabase.co`).

Contoh:

```bash
# jika frontend dan backend satu domain/reverse proxy
VITE_API_BASE=

# jika backend beda domain
VITE_API_BASE=https://api-domain-kamu.com
```

Untuk backend production jalankan dengan `.env.server`.

Key environment backend yang dipakai:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (utama)
- `SUPABASE_SERVICE_ROLE_KEY` (alias kompatibilitas)

## Endpoint Backend Ringkas

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/clients`
- `POST /api/clients/register`
- `PATCH /api/clients/:id/status`
- `GET /api/media`
- `POST /api/control/media/upload`
- `POST /api/control/screen`
- `POST /api/control/media/play`
- `POST /api/control/media/stop`
- `GET /api/schedules`
- `POST /api/schedules`
- `PATCH /api/schedules/:id`
- `DELETE /api/schedules/:id`

## RuoYi Admin Compatibility

Backend ini sekarang menyediakan endpoint kompatibel RuoYi agar panel admin SpringBoot/Vue RuoYi bisa dipasang ke sistem ini:

- `GET /captchaImage`
- `POST /login`
- `GET /getInfo`
- `GET /getRouters`
- `GET /system/rco/client/list`
- `GET /system/rco/client/:id`
- `POST /system/rco/client`
- `PUT /system/rco/client`
- `DELETE /system/rco/client/:ids`
- `GET /system/rco/media/list`
- `GET /system/rco/media/:id`
- `POST /system/rco/media`
- `POST /system/rco/media/upload`
- `PUT /system/rco/media`
- `DELETE /system/rco/media/:ids`
- `GET /system/rco/schedule/list`
- `GET /system/rco/schedule/:id`
- `POST /system/rco/schedule`
- `PUT /system/rco/schedule`
- `DELETE /system/rco/schedule/:ids`
- `POST /system/rco/screen`
- `POST /system/rco/task`
- `GET /system/rco/task/presets`
- `POST /system/rco/task/preset/:key`

Catatan integrasi:

- Login RuoYi akan mendapatkan token JWT dari server ini.
- Header auth tetap format `Authorization: Bearer <token>`.
- Menu RuoYi di-load dari `GET /getRouters` dan sudah berisi modul RCO.
- Data modul RCO dibaca dari tabel Supabase (`clients`, `media`, `schedules`, `rco_*`).

Paket konfigurasi frontend RuoYi siap pakai ada di:

- `deploy/ruoyi-frontend/README.md`
- `deploy/ruoyi-frontend/src/api/rco/client.js`
- `deploy/ruoyi-frontend/src/api/rco/media.js`
- `deploy/ruoyi-frontend/src/api/rco/schedule.js`
- `deploy/ruoyi-frontend/src/api/rco/control.js`

## Original Command Mapping (Verified from APK)

Berikut command asli dari sisi APK (hasil decompile), berbasis field `type` pada `ServerTaskBean`.

Sumber referensi code:

- `embedded_base_jadx/sources/com/remote/framework/websocket/action/a.java`
- `embedded_base_jadx/sources/com/remote/framework/websocket/f.java`
- `embedded_base_jadx/sources/com/remote/framework/websocket/action/w.java`
- `embedded_base_jadx/sources/com/remote/server/mx/binder/ScreenRecordTransactionHandler.java`

Mapping task yang relevan untuk control:

- `10049`: Wake up screen (`PowerManager.WakeLock`)  
	Padanan backend saat ini: `action=on` pada `POST /system/rco/screen`
- `10020`: Lock phone  
	Padanan backend saat ini: `action=lock` pada `POST /system/rco/screen`
- `10021`: Unlock phone  
	Padanan backend saat ini: `action=unlock` pada `POST /system/rco/screen`
- `10018` / `10038`: OpenVideoAction start/stop stream (`isOpenVideo=true/false`)  
	Catatan: ini video streaming remote, bukan playback media library panel
- `10025`: TakeScreenshotAction
- `10004`: Full-screen mask (overlay show/hide)
- `99999`: Uninstall self
- `10056`: Launch full-screen web activity (pakai `apkUrl` sebagai URL)

Binder operation asli (mx server side) yang terverifikasi:

- `isScreenRecording`
- `startScreenRecord`
- `stopScreenRecord`

Catatan penting:

- Command queue Supabase kita saat ini menyimpan `command_type` string (`screen`, `media:play`, `media:stop`) untuk kestabilan panel.
- Jika ingin 1:1 format asli APK, tahap berikutnya adalah ubah producer command agar kirim `payload.type=<angka task asli>` + field pendukung (`isOpenVideo`, `apkUrl`, dll) sesuai kontrak `ServerTaskBean`.
