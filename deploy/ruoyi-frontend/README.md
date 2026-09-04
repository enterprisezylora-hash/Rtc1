# RuoYi Frontend Integration Pack

Paket ini untuk project frontend RuoYi (`ruoyi-ui`) agar langsung terhubung ke backend `screen-media-control`.

## 1) Konfigurasi base API

Atur env RuoYi:

```bash
# .env.development
VUE_APP_BASE_API=http://your-server-domain
```

Untuk production:

```bash
# .env.production
VUE_APP_BASE_API=https://your-server-domain
```

## 2) Tempel file API

Salin file di folder `src/api/rco/` ini ke project RuoYi target:

- `client.js`
- `media.js`
- `schedule.js`
- `control.js`
- `redis.js`

Struktur `src` paket ini:

```text
src/
	api/
		rco/
			client.js
			control.js
			media.js
			redis.js
			schedule.js
	views/
		rco/
			device/index.vue
			media/index.vue
			schedule/index.vue
	router/
		modules/
			rco.js
	utils/
		rcoWs.js
```

## 2b) Tempel file View (RuoYi asli style)

Salin folder ini ke project RuoYi frontend target (`ruoyi-ui/src/views/rco/`):

- `src/views/rco/device/index.vue`
- `src/views/rco/media/index.vue`
- `src/views/rco/schedule/index.vue`

Semua halaman sudah pakai pola komponen RuoYi + Element + `v-hasPermi`.
Halaman device juga sudah terhubung websocket `/ws` (auto reconnect) untuk update realtime status command.

## 2c) Route component mapping

Pastikan backend `/getRouters` mengembalikan component berikut (sudah sesuai backend ini):

- `rco/device/index`
- `rco/media/index`
- `rco/schedule/index`

## 2d) Static router fallback (opsional, jika tidak pakai dynamic menu)

Tanpa edit manual, jalankan patch otomatis ini ke repo frontend RuoYi target:

```bash
chmod +x deploy/ruoyi-frontend/scripts/patch-ruoyi-router.sh
deploy/ruoyi-frontend/scripts/patch-ruoyi-router.sh /path/ke/repo-frontend-ruoyi
```

Script akan:

- copy `src/router/modules/rco.js` ke target
- patch file router utama target (`src/router/index.js` atau `src/router/index.ts`)
- auto tambah import `rcoRouter`
- auto daftar `rcoRouter` ke `asyncRoutes` (fallback `constantRoutes`)

Validasi cepat setelah patch:

```bash
rg -n "import rcoRouter from './modules/rco'|import rcoRouter from \"./modules/rco\"" /path/ke/repo-frontend-ruoyi/src/router/index.js
rg -n "^[[:space:]]*rcoRouter[[:space:]]*,?[[:space:]]*$" /path/ke/repo-frontend-ruoyi/src/router/index.js
ls -la /path/ke/repo-frontend-ruoyi/src/router/modules/rco.js
```

Jika target memakai `index.ts`, ganti path file validasi ke `src/router/index.ts`.

## 3) Auth flow RuoYi

Backend ini sudah menyediakan endpoint standar RuoYi:

- `GET /captchaImage`
- `POST /login`
- `GET /getInfo`
- `GET /getRouters`

Token disimpan seperti RuoYi normal (`Authorization: Bearer <token>`).

## 4) Menu binding

Menu modul RCO diambil otomatis dari `/getRouters`, jadi tidak perlu hardcode router statis.

## 5) Endpoint CRUD RCO (RuoYi style)

Client:
- `GET /system/rco/client/list`
- `GET /system/rco/client/:id`
- `POST /system/rco/client`
- `PUT /system/rco/client`
- `DELETE /system/rco/client/:ids`

Media:
- `GET /system/rco/media/list`
- `GET /system/rco/media/:id`
- `POST /system/rco/media`
- `POST /system/rco/media/upload`
- `PUT /system/rco/media`
- `DELETE /system/rco/media/:ids`

Schedule:
- `GET /system/rco/schedule/list`
- `GET /system/rco/schedule/:id`
- `POST /system/rco/schedule`
- `PUT /system/rco/schedule`
- `DELETE /system/rco/schedule/:ids`

Control:
- `POST /system/rco/screen`
- `POST /system/rco/task` (raw original APK ServerTaskBean by `type`)
- `GET /system/rco/task/presets`
- `POST /system/rco/task/preset/:key`
- `GET /system/rco/command/list` (audit queued/sent/acked/failed)

Monitoring:

- `GET /api/redis/health`
- `GET /api/redis/queue-stats`

Preset key yang tersedia:

- `wake`
- `lock`
- `unlock`
- `openVideo`
- `stopVideo`
- `screenshot`
- `openWeb`
- `uninstallSelf`

## Permission keys (v-hasPermi)

- `rco:client:list`
- `rco:client:query`
- `rco:client:add`
- `rco:client:edit`
- `rco:client:remove`
- `rco:media:list`
- `rco:media:query`
- `rco:media:add`
- `rco:media:upload`
- `rco:media:edit`
- `rco:media:remove`
- `rco:schedule:list`
- `rco:schedule:query`
- `rco:schedule:add`
- `rco:schedule:edit`
- `rco:schedule:remove`
- `rco:control:screen`
- `rco:control:task`
- `rco:control:preset`
- `rco:audit:list`
- `rco:redis:monitor`

## Original type examples (APK-compatible)

Gunakan `POST /system/rco/task` dengan body seperti:

```json
{
	"targetId": null,
	"type": 10049,
	"msg": "screen on"
}
```

Contoh type umum:

- `10049`: wake/screen on
- `10020`: lock phone
- `10021`: unlock phone
- `10018`: open/stop video stream (`isOpenVideo` true/false)
- `10025`: take screenshot
- `10056`: open full-screen web (`apkUrl`)

## 6) Java/SpringBoot coexistence

Jika panel Java SpringBoot RuoYi tetap dipakai sebagai shell admin, backend Node ini bisa dipasang sebagai service control terpisah selama endpoint di atas bisa diakses dari frontend RuoYi.
