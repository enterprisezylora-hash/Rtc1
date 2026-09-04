import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'
import { createClient as createRedisClient } from 'redis'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { WebSocketServer } from 'ws'
import { v4 as uuidv4 } from 'uuid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()

const PORT = Number(process.env.PORT || 8787)
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-dev-secret'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

const S3_ENDPOINT = process.env.SUPABASE_STORAGE_S3_ENDPOINT || ''
const S3_REGION = process.env.SUPABASE_STORAGE_REGION || ''
const S3_ACCESS_KEY = process.env.SUPABASE_STORAGE_ACCESS_KEY || ''
const S3_SECRET_KEY = process.env.SUPABASE_STORAGE_SECRET_KEY || ''
const S3_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || ''
const S3_PUBLIC_BASE_URL = process.env.SUPABASE_STORAGE_PUBLIC_BASE_URL || ''

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const REDIS_URL = process.env.REDIS_URL || 'redis://redis.internal:6379'
const REDIS_ENABLED = String(process.env.REDIS_ENABLED || 'true') !== 'false'
const REDIS_CLUSTER_CHANNEL = process.env.REDIS_CLUSTER_CHANNEL || 'rco:cluster:events'
const REDIS_STATUS_CHANNEL = process.env.REDIS_STATUS_CHANNEL || 'rco:status:events'
const REDIS_COMMAND_STREAM = process.env.REDIS_COMMAND_STREAM || 'rco:commands:stream'
const REDIS_COMMAND_LIST = process.env.REDIS_COMMAND_LIST || 'rco:commands:list'
const REDIS_SNAPSHOT_CACHE_KEY = process.env.REDIS_SNAPSHOT_CACHE_KEY || 'rco:cache:snapshot'
const REDIS_HEALTH_CACHE_KEY = process.env.REDIS_HEALTH_CACHE_KEY || 'rco:cache:health'
const REDIS_CACHE_TTL_SECONDS = Number(process.env.REDIS_CACHE_TTL_SECONDS || 3)
const INSTANCE_ID = process.env.INSTANCE_ID || uuidv4()

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const s3Enabled = Boolean(S3_ENDPOINT && S3_REGION && S3_ACCESS_KEY && S3_SECRET_KEY && S3_BUCKET)
const rcoEnabled = true

const uploadDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const s3Client = s3Enabled
  ? new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
    })
  : null

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
})

const redisPub = REDIS_ENABLED ? createRedisClient({ url: REDIS_URL }) : null
const redisSub = REDIS_ENABLED ? createRedisClient({ url: REDIS_URL }) : null
let redisReady = false

app.use(cors())
app.use(express.json({ limit: '8mb' }))
app.use('/media/uploads', express.static(uploadDir))

function now() {
  return new Date().toISOString()
}

function safeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function buildStorageKey(originalName) {
  return `media/${new Date().toISOString().slice(0, 10)}/${Date.now()}_${uuidv4()}_${safeFilename(originalName)}`
}

function buildPublicUrl(key) {
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  if (S3_PUBLIC_BASE_URL) {
    return `${S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${encodedKey}`
  }
  if (SUPABASE_URL && S3_BUCKET) {
    return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${S3_BUCKET}/${encodedKey}`
  }
  return `${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/${encodedKey}`
}

async function storeUploadedFile(file) {
  const key = buildStorageKey(file.originalname)
  if (s3Enabled && s3Client) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      })
    )

    return {
      path: key,
      url: buildPublicUrl(key),
      provider: 'supabase-s3',
    }
  }

  const localName = `${Date.now()}_${safeFilename(file.originalname)}`
  const fullPath = path.join(uploadDir, localName)
  fs.writeFileSync(fullPath, file.buffer)
  return {
    path: localName,
    url: `/media/uploads/${localName}`,
    provider: 'local',
  }
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role, permissions: permissionsForRole(user.role) }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  })
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing bearer token' })
  }

  const token = header.slice(7)
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    return next()
  } catch {
    return res.status(401).json({ error: 'invalid token' })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'insufficient role' })
    }
    return next()
  }
}

const ROLE_PERMISSIONS = {
  admin: ['*:*:*'],
  operator: [
    'rco:client:list',
    'rco:client:query',
    'rco:client:add',
    'rco:client:edit',
    'rco:media:list',
    'rco:media:query',
    'rco:media:add',
    'rco:media:upload',
    'rco:media:edit',
    'rco:schedule:list',
    'rco:schedule:query',
    'rco:schedule:add',
    'rco:schedule:edit',
    'rco:control:screen',
    'rco:control:task',
    'rco:control:preset',
    'rco:audit:list',
    'rco:redis:monitor',
  ],
  viewer: ['rco:client:list', 'rco:client:query', 'rco:media:list', 'rco:media:query', 'rco:schedule:list', 'rco:schedule:query', 'rco:audit:list'],
}

function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || []
}

function hasPermission(userPermissions, expected) {
  if (!expected) return true
  if (!Array.isArray(userPermissions) || userPermissions.length === 0) return false
  if (userPermissions.includes('*:*:*')) return true
  return userPermissions.includes(expected)
}

function requirePermi(...permissions) {
  return (req, res, next) => {
    const userPerms = permissionsForRole(req.user?.role)
    const allowed = permissions.some((perm) => hasPermission(userPerms, perm))
    if (!allowed) {
      return res.status(403).json({ code: 403, msg: '无权限访问' })
    }
    return next()
  }
}

function ruoyiOk(payload = null, msg = '操作成功') {
  const base = { code: 200, msg }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...base, ...payload }
  }
  if (payload !== null) {
    return { ...base, data: payload }
  }
  return base
}

function ruoyiFail(msg = '操作失败', code = 500) {
  return { code, msg }
}

function ruoyiAuth(req, res, next) {
  return authenticate(req, res, next)
}

function parseIdList(idsText) {
  return String(idsText || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

function logEvent(level, event, data = {}) {
  const entry = {
    ts: now(),
    level,
    event,
    instanceId: INSTANCE_ID,
    ...data,
  }
  const line = JSON.stringify(entry)
  if (level === 'error') {
    console.error(line)
    return
  }
  if (level === 'warn') {
    console.warn(line)
    return
  }
  console.log(line)
}

async function initRedisLayer() {
  if (!REDIS_ENABLED || !redisPub || !redisSub) return
  try {
    redisPub.on('error', (error) => {
      redisReady = false
      logEvent('warn', 'redis.pub.error', { message: error.message, mode: 'supabase-only' })
    })
    redisSub.on('error', (error) => {
      redisReady = false
      logEvent('warn', 'redis.sub.error', { message: error.message, mode: 'supabase-only' })
    })
    await redisPub.connect()
    await redisSub.connect()

    await redisSub.subscribe(REDIS_CLUSTER_CHANNEL, (raw) => {
      try {
        const event = JSON.parse(raw)
        if (!event || event.instanceId === INSTANCE_ID) return
        if (event.type === 'ws' && event.payload) {
          broadcastLocal(event.payload)
        }
      } catch {
        console.warn('[redis] cluster payload parse failed')
      }
    })

    await redisSub.subscribe(REDIS_STATUS_CHANNEL, (raw) => {
      try {
        const event = JSON.parse(raw)
        if (!event || event.instanceId === INSTANCE_ID) return
        broadcastLocal({
          type: 'rco-status',
          data: event,
        })
      } catch {
        console.warn('[redis] status payload parse failed')
      }
    })

    redisReady = true
    logEvent('info', 'redis.connected', { redisUrl: REDIS_URL })
  } catch (error) {
    redisReady = false
    logEvent('warn', 'redis.init.failed', { message: error.message, mode: 'supabase-only' })
  }
}

async function redisSetJson(key, value, ttlSeconds = REDIS_CACHE_TTL_SECONDS) {
  if (!redisReady || !redisPub) return
  try {
    await redisPub.set(key, JSON.stringify(value), { EX: ttlSeconds })
  } catch (error) {
    redisReady = false
    logEvent('warn', 'redis.cache.write.failed', { key, message: error.message, mode: 'supabase-only' })
  }
}

async function redisGetJson(key) {
  if (!redisReady || !redisPub) return null
  let raw = null
  try {
    raw = await redisPub.get(key)
  } catch (error) {
    redisReady = false
    logEvent('warn', 'redis.cache.read.failed', { key, message: error.message, mode: 'supabase-only' })
    return null
  }
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function publishClusterEvent(type, payload) {
  if (!redisReady || !redisPub) return
  const body = {
    instanceId: INSTANCE_ID,
    type,
    payload,
    at: now(),
  }
  try {
    await redisPub.publish(REDIS_CLUSTER_CHANNEL, JSON.stringify(body))
  } catch (error) {
    redisReady = false
    logEvent('warn', 'redis.cluster.publish.failed', { type, message: error.message, mode: 'supabase-only' })
  }
}

async function publishStatusEvent(statusPayload) {
  if (!redisReady || !redisPub) return
  const body = {
    instanceId: INSTANCE_ID,
    ...statusPayload,
    at: now(),
  }
  try {
    await redisPub.publish(REDIS_STATUS_CHANNEL, JSON.stringify(body))
  } catch (error) {
    redisReady = false
    logEvent('warn', 'redis.status.publish.failed', { message: error.message, mode: 'supabase-only' })
  }
}

async function mirrorQueuedCommandsToRedis(commands = []) {
  if (!redisReady || !redisPub || !commands.length) return
  const tx = redisPub.multi()
  for (const cmd of commands) {
    const packed = JSON.stringify({
      id: cmd.id,
      deviceId: cmd.device_id,
      commandType: cmd.command_type,
      status: cmd.status,
      requestedBy: cmd.requested_by,
      requestedAt: cmd.requested_at,
      payload: cmd.payload,
    })
    tx.xAdd(REDIS_COMMAND_STREAM, '*', { command: packed })
    tx.lPush(REDIS_COMMAND_LIST, packed)
  }
  try {
    await tx.exec()
  } catch (error) {
    redisReady = false
    logEvent('warn', 'redis.queue.mirror.failed', {
      stream: REDIS_COMMAND_STREAM,
      list: REDIS_COMMAND_LIST,
      count: commands.length,
      message: error.message,
      mode: 'supabase-only',
    })
  }
}

function createLegacyServerTask(type, fields = {}) {
  return {
    taskId: fields.taskId || uuidv4(),
    type,
    status: typeof fields.status === 'number' ? fields.status : 0,
    isOpenVideo: Boolean(fields.isOpenVideo || false),
    isShow: Boolean(fields.isShow || false),
    clickXy: fields.clickXy || '',
    startXy: fields.startXy || '',
    endXy: fields.endXy || '',
    swipeStartX: Number(fields.swipeStartX || 0),
    swipeStartY: Number(fields.swipeStartY || 0),
    swipeEndX: Number(fields.swipeEndX || 0),
    swipeEndY: Number(fields.swipeEndY || 0),
    swipeDuration: Number(fields.swipeDuration || 0),
    longClickXy: fields.longClickXy || '',
    longClickDuration: Number(fields.longClickDuration || 0),
    packageName: fields.packageName || '',
    bundleId: fields.bundleId || '',
    unInstalPakageName: fields.unInstalPakageName || '',
    apkUrl: fields.apkUrl || '',
    copyText: fields.copyText || '',
    inputType: Number(fields.inputType || 0),
    showType: Number(fields.showType || 0),
    isOpenLayout: Boolean(fields.isOpenLayout || false),
    num: Number(fields.num || 0),
    swipeDirection: Number(fields.swipeDirection || 0),
    msg: fields.msg || '',
    videoMode: Number(fields.videoMode || 0),
    videoPushUrl: fields.videoPushUrl || '',
    videoResolutionMagnification: Number(fields.videoResolutionMagnification || 0),
    videoBitrate: Number(fields.videoBitrate || 0),
    videoFrameRate: Number(fields.videoFrameRate || 0),
    remoteId: fields.remoteId || '',
    amount: fields.amount || '',
    unLockPwd: fields.unLockPwd || '',
  }
}

function mapPanelCommandToLegacyTask(commandType, payload = {}) {
  if (commandType === 'screen') {
    if (payload.action === 'on') {
      return createLegacyServerTask(10049, { msg: 'screen on', isShow: true })
    }
    if (payload.action === 'lock') {
      return createLegacyServerTask(10020, { msg: 'lock phone' })
    }
    if (payload.action === 'unlock') {
      return createLegacyServerTask(10021, {
        msg: 'unlock phone',
        unLockPwd: payload.unLockPwd || '',
      })
    }
    return null
  }

  if (commandType === 'media:play') {
    return createLegacyServerTask(10018, {
      isOpenVideo: true,
      videoPushUrl: payload.videoPushUrl || '',
      videoMode: Number(payload.videoMode || 0),
      videoBitrate: Number(payload.videoBitrate || 0),
      videoFrameRate: Number(payload.videoFrameRate || 0),
      videoResolutionMagnification: Number(payload.videoResolutionMagnification || 0),
      msg: 'open video stream',
    })
  }

  if (commandType === 'media:stop') {
    return createLegacyServerTask(10018, {
      isOpenVideo: false,
      msg: 'stop video stream',
    })
  }

  return null
}

const LEGACY_TASK_PRESETS = {
  wake: {
    type: 10049,
    description: 'Wake up / screen on',
    defaults: { msg: 'screen on' },
  },
  lock: {
    type: 10020,
    description: 'Lock phone',
    defaults: { msg: 'lock phone' },
  },
  unlock: {
    type: 10021,
    description: 'Unlock phone',
    defaults: { msg: 'unlock phone', unLockPwd: '' },
  },
  openVideo: {
    type: 10018,
    description: 'Open video stream',
    defaults: { isOpenVideo: true, msg: 'open video stream' },
  },
  stopVideo: {
    type: 10018,
    description: 'Stop video stream',
    defaults: { isOpenVideo: false, msg: 'stop video stream' },
  },
  screenshot: {
    type: 10025,
    description: 'Take screenshot',
    defaults: { msg: 'take screenshot' },
  },
  openWeb: {
    type: 10056,
    description: 'Open full-screen web activity',
    defaults: { apkUrl: '', msg: 'open web' },
  },
  uninstallSelf: {
    type: 99999,
    description: 'Uninstall self',
    defaults: { msg: 'uninstall self' },
  },
}

function buildLegacyTaskFromPreset(presetKey, overrideFields = {}) {
  const preset = LEGACY_TASK_PRESETS[presetKey]
  if (!preset) {
    return null
  }
  const merged = { ...preset.defaults, ...overrideFields }
  return createLegacyServerTask(preset.type, merged)
}

function buildRuoyiRouters() {
  return [
    {
      name: 'RcoCenter',
      path: '/rco',
      hidden: false,
      redirect: 'noRedirect',
      component: 'Layout',
      alwaysShow: true,
      meta: {
        title: '远控中心',
        icon: 'monitor',
        noCache: false,
        link: null,
      },
      children: [
        {
          name: 'RcoDevice',
          path: 'device',
          hidden: false,
          component: 'rco/device/index',
          meta: {
            title: '设备管理',
            icon: 'desktop',
            noCache: false,
            link: null,
            permissions: ['rco:client:list'],
          },
        },
        {
          name: 'RcoMedia',
          path: 'media',
          hidden: false,
          component: 'rco/media/index',
          meta: {
            title: '媒体管理',
            icon: 'video',
            noCache: false,
            link: null,
            permissions: ['rco:media:list'],
          },
        },
        {
          name: 'RcoSchedule',
          path: 'schedule',
          hidden: false,
          component: 'rco/schedule/index',
          meta: {
            title: '计划任务',
            icon: 'date',
            noCache: false,
            link: null,
            permissions: ['rco:schedule:list'],
          },
        },
      ],
    },
  ]
}

function mapClient(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    online: Boolean(row.online),
    screenOn: Boolean(row.screen_on),
    currentMedia: row.current_media || null,
    lastCommand: row.last_command,
    updatedAt: row.updated_at,
  }
}

function mapMedia(row) {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    mimeType: row.mime_type,
    size: Number(row.size),
    url: row.url,
    createdAt: row.created_at,
  }
}

function mapActivity(row) {
  return {
    id: row.id,
    level: row.level,
    message: row.message,
    payload: row.payload || null,
    createdAt: row.created_at,
  }
}

function mapSchedule(row) {
  return {
    id: row.id,
    targetId: row.target_id,
    mediaId: row.media_id,
    startAt: row.start_at,
    nextRunAt: row.next_run_at,
    repeatMode: row.repeat_mode,
    enabled: Boolean(row.enabled),
    loop: Boolean(row.loop),
    volume: Number(row.volume),
    status: row.status,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
  }
}

function assertOk(result, action) {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`)
  }
  return result.data
}

async function getClients() {
  const data = assertOk(
    await supabaseAdmin.from('clients').select('*').order('name', { ascending: true }),
    'get clients failed'
  )
  return data.map(mapClient)
}

async function getClientById(id) {
  const data = assertOk(await supabaseAdmin.from('clients').select('*').eq('id', id).maybeSingle(), 'get client failed')
  return data ? mapClient(data) : null
}

async function getMedia() {
  const data = assertOk(
    await supabaseAdmin.from('media').select('*').order('created_at', { ascending: false }),
    'get media failed'
  )
  return data.map(mapMedia)
}

async function getMediaById(id) {
  const data = assertOk(await supabaseAdmin.from('media').select('*').eq('id', id).maybeSingle(), 'get media failed')
  return data ? mapMedia(data) : null
}

async function getActivity(limit = 20) {
  const data = assertOk(
    await supabaseAdmin.from('activity').select('*').order('created_at', { ascending: false }).limit(limit),
    'get activity failed'
  )
  return data.map(mapActivity)
}

async function getSchedules() {
  const data = assertOk(
    await supabaseAdmin.from('schedules').select('*').order('created_at', { ascending: false }),
    'get schedules failed'
  )
  return data.map(mapSchedule)
}

async function addActivity(level, message, payload = null) {
  const entry = {
    id: uuidv4(),
    level,
    message,
    payload,
    created_at: now(),
  }

  assertOk(await supabaseAdmin.from('activity').insert(entry), 'insert activity failed')
  const mapped = mapActivity(entry)
  broadcast({ type: 'activity', data: mapped })
  return mapped
}

async function buildStateSnapshot() {
  const [clients, mediaLibrary, schedules, activity] = await Promise.all([
    getClients(),
    getMedia(),
    getSchedules(),
    getActivity(20),
  ])

  return {
    clients,
    mediaLibrary,
    schedules,
    activity,
    serverTime: now(),
  }
}

async function stateSnapshot() {
  const cached = await redisGetJson(REDIS_SNAPSHOT_CACHE_KEY).catch(() => null)
  if (cached) return cached
  const fresh = await buildStateSnapshot()
  await redisSetJson(REDIS_SNAPSHOT_CACHE_KEY, fresh).catch(() => {})
  return fresh
}

async function broadcastSnapshot() {
  const snapshot = await buildStateSnapshot()
  await redisSetJson(REDIS_SNAPSHOT_CACHE_KEY, snapshot).catch(() => {})
  broadcast({ type: 'snapshot', data: snapshot })
}

async function updateClientState(client) {
  assertOk(
    await supabaseAdmin
      .from('clients')
      .update({
        online: Boolean(client.online),
        screen_on: Boolean(client.screenOn),
        current_media: client.currentMedia || null,
        last_command: client.lastCommand || null,
        updated_at: client.updatedAt,
      })
      .eq('id', client.id),
    'update client failed'
  )
}

async function executeScreenAction(action, targetId) {
  const clients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
  if (clients.length === 0) return 0

  for (const client of clients) {
    const next = {
      ...client,
      screenOn: action === 'on' ? true : action === 'off' ? false : client.screenOn,
      lastCommand: `screen:${action}`,
      updatedAt: now(),
    }
    await updateClientState(next)
  }

  return clients.length
}

async function ensureRcoDevice(client) {
  const payload = {
    external_device_id: client.id,
    display_name: client.name,
    platform: client.type || 'android',
    is_online: Boolean(client.online),
    last_seen_at: now(),
    metadata: {
      source: 'screen-media-control',
      panelClientId: client.id,
    },
  }

  const data = assertOk(
    await supabaseAdmin
      .from('rco_devices')
      .upsert(payload, { onConflict: 'external_device_id' })
      .select('id, external_device_id')
      .single(),
    'rco device upsert failed'
  )

  return data
}

async function enqueueRcoCommandBatch({ clients, commandType, payload, requestedBy }) {
  const commandRows = []
  const legacyTask = mapPanelCommandToLegacyTask(commandType, payload)
  for (const client of clients) {
    const device = await ensureRcoDevice(client)
    commandRows.push({
      device_id: device.id,
      command_type: commandType,
      payload: legacyTask
        ? {
            ...legacyTask,
            _meta: {
              sourceCommandType: commandType,
              panelPayload: payload,
            },
          }
        : payload,
      status: 'queued',
      requested_by: requestedBy || null,
    })
  }

  if (commandRows.length === 0) return { enabled: true, queued: 0 }

  const data = assertOk(
    await supabaseAdmin
      .from('rco_commands')
      .insert(commandRows)
      .select('id, device_id, command_type, payload, status, requested_by, requested_at'),
    'rco command insert failed'
  )

  await mirrorQueuedCommandsToRedis(data || []).catch(() => {})
  for (const row of data || []) {
    await publishStatusEvent({
      commandId: row.id,
      deviceId: row.device_id,
      commandType: row.command_type,
      status: row.status,
      taskId: row.payload?.taskId || null,
      type: row.payload?.type ?? null,
    }).catch(() => {})
  }

  return { enabled: true, queued: data?.length || 0 }
}

async function queueLegacyTaskForClients({ targetClients, taskPayload, requestedBy, commandType = 'server_task' }) {
  const commandRows = []
  for (const client of targetClients) {
    const device = await ensureRcoDevice(client)
    commandRows.push({
      device_id: device.id,
      command_type: commandType,
      payload: taskPayload,
      status: 'queued',
      requested_by: requestedBy || null,
    })
  }

  if (!commandRows.length) {
    return { queued: 0 }
  }

  const insertResult = assertOk(
    await supabaseAdmin
      .from('rco_commands')
      .insert(commandRows)
      .select('id, device_id, command_type, payload, status, requested_by, requested_at'),
    'queue server task failed'
  )

  await mirrorQueuedCommandsToRedis(insertResult || []).catch(() => {})
  for (const row of insertResult || []) {
    await publishStatusEvent({
      commandId: row.id,
      deviceId: row.device_id,
      commandType: row.command_type,
      status: row.status,
      taskId: row.payload?.taskId || null,
      type: row.payload?.type ?? null,
    }).catch(() => {})
  }

  return {
    queued: insertResult?.length || 0,
    count: commandRows.length,
  }
}

function mapRcoCommandAudit(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceExternalId: row.device?.external_device_id || null,
    deviceName: row.device?.display_name || null,
    commandType: row.command_type,
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    sentAt: row.sent_at,
    ackedAt: row.acked_at,
    errorMessage: row.error_message,
    taskId: row.payload?.taskId || null,
    type: typeof row.payload?.type === 'number' ? row.payload.type : Number(row.payload?.type || 0),
    payload: row.payload || {},
  }
}

function parsePositiveInt(value, fallback, max = null) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) return fallback
  if (typeof max === 'number') return Math.min(n, max)
  return n
}

async function queryRcoCommandAudit(params = {}) {
  const {
    pageNum = 1,
    pageSize = 20,
    status,
    targetId,
    deviceId,
    taskId,
    type,
    commandType,
  } = params

  const safePageNum = parsePositiveInt(pageNum, 1)
  const safePageSize = parsePositiveInt(pageSize, 20, 200)

  let resolvedDeviceId = null
  if (targetId) {
    const device = assertOk(
      await supabaseAdmin.from('rco_devices').select('id').eq('external_device_id', String(targetId)).maybeSingle(),
      'resolve target device failed'
    )
    if (!device) {
      return { rows: [], total: 0, pageNum: safePageNum, pageSize: safePageSize }
    }
    resolvedDeviceId = device.id
  }

  let query = supabaseAdmin
    .from('rco_commands')
    .select(
      'id, device_id, command_type, payload, status, requested_by, requested_at, sent_at, acked_at, error_message, device:rco_devices(id, external_device_id, display_name)',
      { count: 'exact' }
    )
    .order('requested_at', { ascending: false })

  if (status) query = query.eq('status', String(status))
  if (commandType) query = query.ilike('command_type', `%${String(commandType)}%`)
  if (taskId) query = query.eq('payload->>taskId', String(taskId))
  if (typeof type !== 'undefined' && String(type).trim() !== '') {
    query = query.eq('payload->>type', String(type))
  }

  if (deviceId) {
    query = query.eq('device_id', String(deviceId))
  } else if (resolvedDeviceId) {
    query = query.eq('device_id', resolvedDeviceId)
  }

  const from = (safePageNum - 1) * safePageSize
  const to = from + safePageSize - 1
  const { data, error, count } = await query.range(from, to)
  if (error) {
    throw new Error(`query rco command audit failed: ${error.message}`)
  }

  return {
    rows: (data || []).map(mapRcoCommandAudit),
    total: count || 0,
    pageNum: safePageNum,
    pageSize: safePageSize,
  }
}

async function executePlayMedia({ targetId, mediaId, loop, volume, source }) {
  const media = await getMediaById(mediaId)
  if (!media) return { ok: false, reason: 'media not found' }

  const clients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
  if (clients.length === 0) return { ok: false, reason: 'target client not found' }

  for (const client of clients) {
    const next = {
      ...client,
      currentMedia: {
        mediaId: media.id,
        name: media.name,
        loop: Boolean(loop),
        volume: Number(volume),
        startedAt: now(),
      },
      lastCommand: source === 'scheduler' ? 'media:play:scheduler' : 'media:play',
      updatedAt: now(),
    }
    await updateClientState(next)
  }

  await addActivity('info', `Play media: ${media.name}`, {
    targetId: targetId || 'ALL',
    count: clients.length,
    loop: Boolean(loop),
    volume: Number(volume),
    source,
  })

  broadcast({
    type: 'command',
    data: { command: 'media:play', targetId: targetId || 'ALL', mediaId: media.id, loop, volume, source },
  })
  await broadcastSnapshot()

  return { ok: true, affected: clients.length }
}

async function executeStopMedia(targetId, source) {
  const clients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
  if (clients.length === 0) return { ok: false, reason: 'target client not found' }

  for (const client of clients) {
    const next = {
      ...client,
      currentMedia: null,
      lastCommand: source === 'scheduler' ? 'media:stop:scheduler' : 'media:stop',
      updatedAt: now(),
    }
    await updateClientState(next)
  }

  await addActivity('warning', 'Stop media playback', {
    targetId: targetId || 'ALL',
    count: clients.length,
    source,
  })
  broadcast({ type: 'command', data: { command: 'media:stop', targetId: targetId || 'ALL', source } })
  await broadcastSnapshot()

  return { ok: true, affected: clients.length }
}

async function initSupabaseState() {
  const userRow = assertOk(
    await supabaseAdmin.from('users').select('id, username, role, password_hash').eq('username', ADMIN_USERNAME).maybeSingle(),
    'load admin user failed'
  )

  if (!userRow) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10)
    assertOk(
      await supabaseAdmin.from('users').insert({
        id: uuidv4(),
        username: ADMIN_USERNAME,
        password_hash: hash,
        role: 'admin',
        created_at: now(),
      }),
      'seed admin user failed'
    )
  }

  const countQuery = await supabaseAdmin.from('clients').select('id', { count: 'exact', head: true })
  if (countQuery.error) {
    throw new Error(`count clients failed: ${countQuery.error.message}`)
  }
  const total = Number(countQuery.count || 0)
  if (total === 0) {
    const seeded = [
      { name: 'Front Desk Display', type: 'kiosk' },
      { name: 'Warehouse TV', type: 'android-tv' },
      { name: 'Operator Tablet', type: 'tablet' },
    ]

    for (const item of seeded) {
      assertOk(
        await supabaseAdmin.from('clients').insert({
          id: uuidv4(),
          name: item.name,
          type: item.type,
          online: true,
          screen_on: true,
          current_media: null,
          last_command: null,
          updated_at: now(),
        }),
        'seed client failed'
      )
    }
  }
}

async function processDueSchedules() {
  const dueRows = assertOk(
    await supabaseAdmin
      .from('schedules')
      .select('*')
      .eq('enabled', true)
      .lte('next_run_at', now())
      .order('next_run_at', { ascending: true }),
    'load due schedules failed'
  )

  if (!dueRows.length) return

  for (const row of dueRows) {
    const schedule = mapSchedule(row)
    const result = await executePlayMedia({
      targetId: schedule.targetId,
      mediaId: schedule.mediaId,
      loop: schedule.loop,
      volume: schedule.volume,
      source: 'scheduler',
    })

    const runAt = now()
    if (!result.ok) {
      await supabaseAdmin
        .from('schedules')
        .update({ status: 'failed', last_run_at: runAt, updated_at: runAt })
        .eq('id', schedule.id)
      continue
    }

    if (schedule.repeatMode === 'daily') {
      const next = new Date(schedule.nextRunAt)
      next.setDate(next.getDate() + 1)
      await supabaseAdmin
        .from('schedules')
        .update({
          status: 'scheduled',
          last_run_at: runAt,
          next_run_at: next.toISOString(),
          updated_at: runAt,
        })
        .eq('id', schedule.id)
    } else {
      await supabaseAdmin
        .from('schedules')
        .update({
          status: 'completed',
          last_run_at: runAt,
          enabled: false,
          updated_at: runAt,
        })
        .eq('id', schedule.id)
    }
  }

  await broadcastSnapshot()
}

app.get('/captchaImage', (_req, res) => {
  return res.json({
    code: 200,
    msg: '操作成功',
    captchaEnabled: false,
    uuid: uuidv4(),
    img: '',
  })
})

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) {
      return res.status(400).json(ruoyiFail('用户名和密码不能为空', 400))
    }

    const user = assertOk(
      await supabaseAdmin.from('users').select('*').eq('username', username).maybeSingle(),
      'load user failed'
    )

    if (!user) {
      return res.status(401).json(ruoyiFail('用户名或密码错误', 401))
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json(ruoyiFail('用户名或密码错误', 401))
    }

    const token = signToken(user)
    return res.json(ruoyiOk({ token }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/getInfo', ruoyiAuth, async (req, res) => {
  try {
    const user = assertOk(
      await supabaseAdmin.from('users').select('id, username, role').eq('id', req.user.sub).maybeSingle(),
      'load user info failed'
    )
    if (!user) {
      return res.status(404).json(ruoyiFail('用户不存在', 404))
    }

    const perms = permissionsForRole(user.role || 'viewer')
    return res.json(
      ruoyiOk({
        permissions: perms,
        roles: [user.role || 'admin'],
        user: {
          userId: user.id,
          userName: user.username,
          nickName: user.username,
          avatar: '',
        },
      })
    )
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/getRouters', ruoyiAuth, (_req, res) => {
  return res.json(ruoyiOk(buildRuoyiRouters()))
})

app.get('/system/rco/client/list', ruoyiAuth, requirePermi('rco:client:list'), async (_req, res) => {
  try {
    const rows = await getClients()
    return res.json(ruoyiOk({ rows, total: rows.length }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/system/rco/client/:id', ruoyiAuth, requirePermi('rco:client:query'), async (req, res) => {
  try {
    const row = await getClientById(req.params.id)
    if (!row) return res.status(404).json(ruoyiFail('client not found', 404))
    return res.json(ruoyiOk({ data: row }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.post('/system/rco/client', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:client:add'), async (req, res) => {
  try {
    const { name, type, online = true, screenOn = true } = req.body || {}
    if (!name || !type) {
      return res.status(400).json(ruoyiFail('name and type are required', 400))
    }

    const created = {
      id: uuidv4(),
      name,
      type,
      online: Boolean(online),
      screenOn: Boolean(screenOn),
      currentMedia: null,
      lastCommand: null,
      updatedAt: now(),
    }

    assertOk(
      await supabaseAdmin.from('clients').insert({
        id: created.id,
        name: created.name,
        type: created.type,
        online: created.online,
        screen_on: created.screenOn,
        current_media: null,
        last_command: null,
        updated_at: created.updatedAt,
      }),
      'create client failed'
    )

    await addActivity('info', `Client created via Ruoyi: ${created.name}`, { clientId: created.id })
    await broadcastSnapshot()
    return res.json(ruoyiOk({ data: created }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.put('/system/rco/client', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:client:edit'), async (req, res) => {
  try {
    const { id, name, type, online, screenOn, currentMedia, lastCommand } = req.body || {}
    if (!id) {
      return res.status(400).json(ruoyiFail('id is required', 400))
    }

    const existing = await getClientById(id)
    if (!existing) {
      return res.status(404).json(ruoyiFail('client not found', 404))
    }

    const patch = {
      name: name ?? existing.name,
      type: type ?? existing.type,
      online: typeof online === 'boolean' ? online : existing.online,
      screen_on: typeof screenOn === 'boolean' ? screenOn : existing.screenOn,
      current_media: currentMedia ?? existing.currentMedia,
      last_command: lastCommand ?? existing.lastCommand,
      updated_at: now(),
    }

    assertOk(await supabaseAdmin.from('clients').update(patch).eq('id', id), 'update client failed')

    await addActivity('info', `Client updated via Ruoyi: ${id}`, { clientId: id })
    await broadcastSnapshot()
    return res.json(ruoyiOk())
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.delete('/system/rco/client/:ids', ruoyiAuth, requireRole('admin'), requirePermi('rco:client:remove'), async (req, res) => {
  try {
    const ids = parseIdList(req.params.ids)
    if (!ids.length) {
      return res.status(400).json(ruoyiFail('ids is required', 400))
    }

    assertOk(await supabaseAdmin.from('clients').delete().in('id', ids), 'delete client failed')
    await addActivity('warning', 'Client deleted via Ruoyi', { ids })
    await broadcastSnapshot()
    return res.json(ruoyiOk(ids.length))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/system/rco/media/list', ruoyiAuth, requirePermi('rco:media:list'), async (_req, res) => {
  try {
    const rows = await getMedia()
    return res.json(ruoyiOk({ rows, total: rows.length }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/system/rco/media/:id', ruoyiAuth, requirePermi('rco:media:query'), async (req, res) => {
  try {
    const row = await getMediaById(req.params.id)
    if (!row) return res.status(404).json(ruoyiFail('media not found', 404))
    return res.json(ruoyiOk({ data: row }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.post('/system/rco/media', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:media:add'), async (req, res) => {
  try {
    const { name, path: mediaPath, mimeType, size = 0, url } = req.body || {}
    if (!name || !url) {
      return res.status(400).json(ruoyiFail('name and url are required', 400))
    }

    const created = {
      id: uuidv4(),
      name,
      path: mediaPath || name,
      mimeType: mimeType || 'application/octet-stream',
      size: Number(size || 0),
      url,
      createdAt: now(),
    }

    assertOk(
      await supabaseAdmin.from('media').insert({
        id: created.id,
        name: created.name,
        path: created.path,
        mime_type: created.mimeType,
        size: created.size,
        url: created.url,
        created_at: created.createdAt,
      }),
      'create media failed'
    )

    await addActivity('info', `Media created via Ruoyi: ${created.name}`, { mediaId: created.id })
    await broadcastSnapshot()
    return res.json(ruoyiOk({ data: created }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.post('/system/rco/media/upload', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:media:upload'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(ruoyiFail('file is required', 400))
    }

    const stored = await storeUploadedFile(req.file)
    const created = {
      id: uuidv4(),
      name: req.file.originalname,
      path: stored.path,
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: Number(req.file.size || 0),
      url: stored.url,
      createdAt: now(),
    }

    assertOk(
      await supabaseAdmin.from('media').insert({
        id: created.id,
        name: created.name,
        path: created.path,
        mime_type: created.mimeType,
        size: created.size,
        url: created.url,
        created_at: created.createdAt,
      }),
      'upload media failed'
    )

    await addActivity('info', `Media uploaded via Ruoyi: ${created.name}`, { mediaId: created.id })
    await broadcastSnapshot()
    return res.json(ruoyiOk({ data: created }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.put('/system/rco/media', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:media:edit'), async (req, res) => {
  try {
    const { id, name, path: mediaPath, mimeType, size, url } = req.body || {}
    if (!id) {
      return res.status(400).json(ruoyiFail('id is required', 400))
    }

    const existing = await getMediaById(id)
    if (!existing) {
      return res.status(404).json(ruoyiFail('media not found', 404))
    }

    assertOk(
      await supabaseAdmin
        .from('media')
        .update({
          name: name ?? existing.name,
          path: mediaPath ?? existing.path,
          mime_type: mimeType ?? existing.mimeType,
          size: typeof size === 'number' ? Number(size) : existing.size,
          url: url ?? existing.url,
          updated_at: now(),
        })
        .eq('id', id),
      'update media failed'
    )

    await addActivity('info', `Media updated via Ruoyi: ${id}`, { mediaId: id })
    await broadcastSnapshot()
    return res.json(ruoyiOk())
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.delete('/system/rco/media/:ids', ruoyiAuth, requireRole('admin'), requirePermi('rco:media:remove'), async (req, res) => {
  try {
    const ids = parseIdList(req.params.ids)
    if (!ids.length) {
      return res.status(400).json(ruoyiFail('ids is required', 400))
    }

    assertOk(await supabaseAdmin.from('media').delete().in('id', ids), 'delete media failed')
    await addActivity('warning', 'Media deleted via Ruoyi', { ids })
    await broadcastSnapshot()
    return res.json(ruoyiOk(ids.length))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/system/rco/schedule/list', ruoyiAuth, requirePermi('rco:schedule:list'), async (_req, res) => {
  try {
    const rows = await getSchedules()
    return res.json(ruoyiOk({ rows, total: rows.length }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/system/rco/schedule/:id', ruoyiAuth, requirePermi('rco:schedule:query'), async (req, res) => {
  try {
    const row = assertOk(
      await supabaseAdmin.from('schedules').select('*').eq('id', req.params.id).maybeSingle(),
      'get schedule failed'
    )
    if (!row) return res.status(404).json(ruoyiFail('schedule not found', 404))
    return res.json(ruoyiOk({ data: mapSchedule(row) }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.post('/system/rco/schedule', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:schedule:add'), async (req, res) => {
  try {
    const {
      targetId = null,
      mediaId,
      startAt,
      nextRunAt,
      repeatMode = 'once',
      loop = false,
      volume = 70,
      enabled = true,
      status = 'scheduled',
    } = req.body || {}

    if (!mediaId || !startAt) {
      return res.status(400).json(ruoyiFail('mediaId and startAt are required', 400))
    }

    const id = uuidv4()
    const createdAt = now()
    assertOk(
      await supabaseAdmin.from('schedules').insert({
        id,
        target_id: targetId,
        media_id: mediaId,
        start_at: startAt,
        next_run_at: nextRunAt || startAt,
        repeat_mode: repeatMode,
        enabled: Boolean(enabled),
        loop: Boolean(loop),
        volume: Number(volume),
        status,
        last_run_at: null,
        created_at: createdAt,
        updated_at: createdAt,
      }),
      'create schedule failed'
    )

    await addActivity('info', `Schedule created via Ruoyi: ${id}`, { scheduleId: id })
    await broadcastSnapshot()
    return res.json(ruoyiOk({ data: { id } }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.put('/system/rco/schedule', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:schedule:edit'), async (req, res) => {
  try {
    const {
      id,
      targetId,
      mediaId,
      startAt,
      nextRunAt,
      repeatMode,
      enabled,
      loop,
      volume,
      status,
      lastRunAt,
    } = req.body || {}

    if (!id) {
      return res.status(400).json(ruoyiFail('id is required', 400))
    }

    const existing = assertOk(
      await supabaseAdmin.from('schedules').select('*').eq('id', id).maybeSingle(),
      'get schedule failed'
    )
    if (!existing) {
      return res.status(404).json(ruoyiFail('schedule not found', 404))
    }

    const current = mapSchedule(existing)
    assertOk(
      await supabaseAdmin
        .from('schedules')
        .update({
          target_id: targetId ?? current.targetId,
          media_id: mediaId ?? current.mediaId,
          start_at: startAt ?? current.startAt,
          next_run_at: nextRunAt ?? current.nextRunAt,
          repeat_mode: repeatMode ?? current.repeatMode,
          enabled: typeof enabled === 'boolean' ? enabled : current.enabled,
          loop: typeof loop === 'boolean' ? loop : current.loop,
          volume: typeof volume === 'number' ? Number(volume) : current.volume,
          status: status ?? current.status,
          last_run_at: lastRunAt ?? current.lastRunAt,
          updated_at: now(),
        })
        .eq('id', id),
      'update schedule failed'
    )

    await addActivity('info', `Schedule updated via Ruoyi: ${id}`, { scheduleId: id })
    await broadcastSnapshot()
    return res.json(ruoyiOk())
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.delete('/system/rco/schedule/:ids', ruoyiAuth, requireRole('admin'), requirePermi('rco:schedule:remove'), async (req, res) => {
  try {
    const ids = parseIdList(req.params.ids)
    if (!ids.length) {
      return res.status(400).json(ruoyiFail('ids is required', 400))
    }

    assertOk(await supabaseAdmin.from('schedules').delete().in('id', ids), 'delete schedule failed')
    await addActivity('warning', 'Schedule deleted via Ruoyi', { ids })
    await broadcastSnapshot()
    return res.json(ruoyiOk(ids.length))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.post('/system/rco/screen', ruoyiAuth, requirePermi('rco:control:screen'), async (req, res) => {
  try {
    const { targetId = null, action } = req.body || {}
    const validActions = new Set(['on', 'off', 'lock', 'unlock'])
    if (!validActions.has(action)) {
      return res.status(400).json(ruoyiFail('action must be on/off/lock/unlock', 400))
    }

    const targetClients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
    if (targetClients.length === 0) {
      return res.status(404).json(ruoyiFail('target client not found', 404))
    }

    const affected = await executeScreenAction(action, targetId)
    const queueResult = await enqueueRcoCommandBatch({
      clients: targetClients,
      commandType: 'screen',
      payload: { action, targetId: targetId || 'ALL' },
      requestedBy: req.user?.username || req.user?.sub || null,
    })

    await addActivity('warning', `Screen action: ${action}`, {
      targetId: targetId || 'ALL',
      count: affected,
      source: 'ruoyi',
    })
    await broadcastSnapshot()

    return res.json(ruoyiOk({ affected, rcoQueued: queueResult.queued }))
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.post('/system/rco/task', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:control:task'), async (req, res) => {
  try {
    const { targetId = null, type, ...fields } = req.body || {}
    if (typeof type !== 'number') {
      return res.status(400).json(ruoyiFail('type(number) is required', 400))
    }

    const targetClients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
    if (targetClients.length === 0) {
      return res.status(404).json(ruoyiFail('target client not found', 404))
    }

    const taskPayload = createLegacyServerTask(type, fields)
    const queueResult = await queueLegacyTaskForClients({
      targetClients,
      taskPayload,
      requestedBy: req.user?.username || req.user?.sub || null,
    })

    await addActivity('warning', `ServerTask queued: type=${type}`, {
      type,
      targetId: targetId || 'ALL',
      count: queueResult.count,
      taskId: taskPayload.taskId,
      source: 'ruoyi',
    })
    await broadcastSnapshot()

    return res.json(
      ruoyiOk({
        queued: queueResult.queued,
        taskId: taskPayload.taskId,
        type,
      })
    )
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/system/rco/task/presets', ruoyiAuth, requirePermi('rco:control:preset'), (_req, res) => {
  const rows = Object.entries(LEGACY_TASK_PRESETS).map(([key, value]) => ({
    key,
    type: value.type,
    description: value.description,
    defaults: value.defaults,
  }))
  return res.json(ruoyiOk({ rows, total: rows.length }))
})

app.post('/system/rco/task/preset/:key', ruoyiAuth, requireRole('admin', 'operator'), requirePermi('rco:control:preset'), async (req, res) => {
  try {
    const { key } = req.params
    const { targetId = null, ...fields } = req.body || {}
    const taskPayload = buildLegacyTaskFromPreset(key, fields)
    if (!taskPayload) {
      return res.status(404).json(ruoyiFail('preset not found', 404))
    }

    const targetClients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
    if (targetClients.length === 0) {
      return res.status(404).json(ruoyiFail('target client not found', 404))
    }

    const queueResult = await queueLegacyTaskForClients({
      targetClients,
      taskPayload,
      requestedBy: req.user?.username || req.user?.sub || null,
      commandType: `server_task:${key}`,
    })

    await addActivity('warning', `ServerTask preset queued: ${key}`, {
      key,
      type: taskPayload.type,
      targetId: targetId || 'ALL',
      count: queueResult.count,
      taskId: taskPayload.taskId,
      source: 'ruoyi',
    })
    await broadcastSnapshot()

    return res.json(
      ruoyiOk({
        key,
        type: taskPayload.type,
        queued: queueResult.queued,
        taskId: taskPayload.taskId,
      })
    )
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/system/rco/command/list', ruoyiAuth, requirePermi('rco:audit:list'), async (req, res) => {
  try {
    const result = await queryRcoCommandAudit({
      pageNum: req.query.pageNum,
      pageSize: req.query.pageSize,
      status: req.query.status,
      targetId: req.query.targetId,
      deviceId: req.query.deviceId,
      taskId: req.query.taskId,
      type: req.query.type,
      commandType: req.query.commandType,
    })

    return res.json(
      ruoyiOk({
        rows: result.rows,
        total: result.total,
        pageNum: result.pageNum,
        pageSize: result.pageSize,
      })
    )
  } catch (error) {
    return res.status(500).json(ruoyiFail(error.message))
  }
})

app.get('/api/health', (_req, res) => {
  const payload = {
    status: 'ok',
    serverTime: now(),
    wsClients: wss ? wss.clients.size : 0,
    storageProvider: s3Enabled ? 'supabase-s3' : 'local',
    rcoProvider: rcoEnabled ? (redisReady ? 'supabase-rco+redis' : 'supabase-rco') : 'disabled',
    dataProvider: 'supabase',
    redis: {
      enabled: REDIS_ENABLED,
      ready: redisReady,
      url: REDIS_URL,
      clusterChannel: REDIS_CLUSTER_CHANNEL,
      statusChannel: REDIS_STATUS_CHANNEL,
    },
  }
  redisSetJson(REDIS_HEALTH_CACHE_KEY, payload).catch(() => {})
  res.json(payload)
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' })
    }

    const user = assertOk(
      await supabaseAdmin.from('users').select('*').eq('username', username).maybeSingle(),
      'load user failed'
    )

    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'invalid credentials' })
    }

    const token = signToken(user)
    return res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.use('/api', (req, res, next) => {
  const publicPaths = new Set(['/health', '/auth/login'])
  if (publicPaths.has(req.path)) return next()
  return authenticate(req, res, next)
})

app.get('/api/auth/me', (req, res) => {
  return res.json({ user: req.user })
})

app.get('/api/redis/health', requireRole('admin', 'operator'), requirePermi('rco:redis:monitor'), async (_req, res) => {
  const payload = {
    enabled: REDIS_ENABLED,
    ready: redisReady,
    instanceId: INSTANCE_ID,
    redisUrl: REDIS_URL,
    clusterChannel: REDIS_CLUSTER_CHANNEL,
    statusChannel: REDIS_STATUS_CHANNEL,
    streamKey: REDIS_COMMAND_STREAM,
    listKey: REDIS_COMMAND_LIST,
    cacheKeys: {
      snapshot: REDIS_SNAPSHOT_CACHE_KEY,
      health: REDIS_HEALTH_CACHE_KEY,
    },
    mode: redisReady ? 'supabase+redis' : 'supabase-only',
    checkedAt: now(),
  }

  if (!REDIS_ENABLED || !redisPub) {
    return res.json(payload)
  }

  try {
    const ping = redisReady ? await redisPub.ping() : 'NOT_CONNECTED'
    return res.json({ ...payload, ping })
  } catch (error) {
    redisReady = false
    logEvent('warn', 'redis.health.ping.failed', { message: error.message, mode: 'supabase-only' })
    return res.json({ ...payload, ready: false, ping: 'ERROR', error: error.message, mode: 'supabase-only' })
  }
})

app.get('/api/redis/queue-stats', requireRole('admin', 'operator'), requirePermi('rco:redis:monitor'), async (_req, res) => {
  if (!REDIS_ENABLED || !redisPub || !redisReady) {
    return res.json({
      enabled: REDIS_ENABLED,
      ready: redisReady,
      mode: 'supabase-only',
      checkedAt: now(),
      stats: null,
    })
  }

  try {
    const [streamLength, listLength, snapshotExists, healthExists] = await Promise.all([
      redisPub.xLen(REDIS_COMMAND_STREAM),
      redisPub.lLen(REDIS_COMMAND_LIST),
      redisPub.exists(REDIS_SNAPSHOT_CACHE_KEY),
      redisPub.exists(REDIS_HEALTH_CACHE_KEY),
    ])

    return res.json({
      enabled: true,
      ready: true,
      mode: 'supabase+redis',
      checkedAt: now(),
      stats: {
        streamKey: REDIS_COMMAND_STREAM,
        streamLength,
        listKey: REDIS_COMMAND_LIST,
        listLength,
        snapshotCacheExists: snapshotExists > 0,
        healthCacheExists: healthExists > 0,
      },
    })
  } catch (error) {
    redisReady = false
    logEvent('warn', 'redis.queue.stats.failed', { message: error.message, mode: 'supabase-only' })
    return res.status(200).json({
      enabled: true,
      ready: false,
      mode: 'supabase-only',
      checkedAt: now(),
      error: error.message,
      stats: null,
    })
  }
})

app.get('/api/clients', async (_req, res) => {
  try {
    return res.json({ data: await getClients() })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.post('/api/clients/register', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { name, type } = req.body || {}
    if (!name || !type) {
      return res.status(400).json({ error: 'name and type are required' })
    }

    const client = {
      id: uuidv4(),
      name,
      type,
      online: true,
      screenOn: true,
      currentMedia: null,
      lastCommand: null,
      updatedAt: now(),
    }

    assertOk(
      await supabaseAdmin.from('clients').insert({
        id: client.id,
        name: client.name,
        type: client.type,
        online: true,
        screen_on: true,
        current_media: null,
        last_command: null,
        updated_at: client.updatedAt,
      }),
      'register client failed'
    )

    await addActivity('info', `Client registered: ${name}`, { clientId: client.id })
    await broadcastSnapshot()
    return res.status(201).json({ data: client })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.patch('/api/clients/:id/status', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const client = await getClientById(req.params.id)
    if (!client) {
      return res.status(404).json({ error: 'client not found' })
    }

    const { online, screenOn } = req.body || {}
    if (typeof online === 'boolean') client.online = online
    if (typeof screenOn === 'boolean') client.screenOn = screenOn
    client.updatedAt = now()

    await updateClientState(client)
    await addActivity('info', `Status updated: ${client.name}`, {
      clientId: client.id,
      online: client.online,
      screenOn: client.screenOn,
    })
    await broadcastSnapshot()

    return res.json({ data: client })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.get('/api/media', async (_req, res) => {
  try {
    return res.json({ data: await getMedia() })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.post('/api/control/media/upload', requireRole('admin', 'operator'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' })
    }

    const stored = await storeUploadedFile(req.file)
    const media = {
      id: uuidv4(),
      name: req.file.originalname,
      path: stored.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
      url: stored.url,
      createdAt: now(),
    }

    assertOk(
      await supabaseAdmin.from('media').insert({
        id: media.id,
        name: media.name,
        path: media.path,
        mime_type: media.mimeType,
        size: media.size,
        url: media.url,
        created_at: media.createdAt,
      }),
      'insert media failed'
    )

    await addActivity('info', `Media uploaded: ${media.name}`, {
      mediaId: media.id,
      storage: stored.provider,
    })
    await broadcastSnapshot()

    return res.status(201).json({ data: media })
  } catch (error) {
    return res.status(500).json({ error: `upload failed: ${error.message}` })
  }
})

app.post('/api/control/screen', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { targetId, action } = req.body || {}
    const validActions = new Set(['on', 'off', 'lock', 'unlock'])
    if (!validActions.has(action)) {
      return res.status(400).json({ error: 'action must be on/off/lock/unlock' })
    }

    const targetClients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
    if (targetClients.length === 0) {
      return res.status(404).json({ error: 'target client not found' })
    }

    const affected = await executeScreenAction(action, targetId)

    await addActivity('warning', `Screen action: ${action}`, {
      targetId: targetId || 'ALL',
      count: affected,
    })

    const queueResult = await enqueueRcoCommandBatch({
      clients: targetClients,
      commandType: 'screen',
      payload: {
        action,
        targetId: targetId || 'ALL',
      },
      requestedBy: req.user?.username || req.user?.sub || null,
    })

    broadcast({ type: 'command', data: { command: 'screen', action, targetId: targetId || 'ALL' } })
    await broadcastSnapshot()

    return res.json({ ok: true, affected, rcoQueued: queueResult.queued })
  } catch (error) {
    await addActivity('error', 'RCO enqueue failed (screen)', { error: error.message }).catch(() => {})
    return res.status(502).json({ error: error.message })
  }
})

app.post('/api/control/media/play', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { targetId, mediaId, loop = false, volume = 70 } = req.body || {}
    const targetClients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
    if (targetClients.length === 0) {
      return res.status(404).json({ error: 'target client not found' })
    }

    const result = await executePlayMedia({ targetId, mediaId, loop, volume, source: 'manual' })
    if (!result.ok) return res.status(404).json({ error: result.reason })

    const queueResult = await enqueueRcoCommandBatch({
      clients: targetClients,
      commandType: 'media:play',
      payload: {
        mediaId,
        loop: Boolean(loop),
        volume: Number(volume),
        targetId: targetId || 'ALL',
      },
      requestedBy: req.user?.username || req.user?.sub || null,
    })

    return res.json({ ...result, rcoQueued: queueResult.queued })
  } catch (error) {
    await addActivity('error', 'RCO enqueue failed (media play)', { error: error.message }).catch(() => {})
    return res.status(502).json({ error: error.message })
  }
})

app.post('/api/control/media/stop', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { targetId } = req.body || {}
    const targetClients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
    if (targetClients.length === 0) {
      return res.status(404).json({ error: 'target client not found' })
    }

    const result = await executeStopMedia(targetId, 'manual')
    if (!result.ok) return res.status(404).json({ error: result.reason })

    const queueResult = await enqueueRcoCommandBatch({
      clients: targetClients,
      commandType: 'media:stop',
      payload: {
        targetId: targetId || 'ALL',
      },
      requestedBy: req.user?.username || req.user?.sub || null,
    })

    return res.json({ ...result, rcoQueued: queueResult.queued })
  } catch (error) {
    await addActivity('error', 'RCO enqueue failed (media stop)', { error: error.message }).catch(() => {})
    return res.status(502).json({ error: error.message })
  }
})

app.post('/api/control/task', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { targetId = null, type, ...fields } = req.body || {}
    if (typeof type !== 'number') {
      return res.status(400).json({ error: 'type(number) is required' })
    }

    const targetClients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
    if (targetClients.length === 0) {
      return res.status(404).json({ error: 'target client not found' })
    }

    const taskPayload = createLegacyServerTask(type, fields)
    const queueResult = await queueLegacyTaskForClients({
      targetClients,
      taskPayload,
      requestedBy: req.user?.username || req.user?.sub || null,
    })

    await addActivity('warning', `ServerTask queued: type=${type}`, {
      type,
      targetId: targetId || 'ALL',
      count: queueResult.count,
      taskId: taskPayload.taskId,
      source: 'api',
    })
    await broadcastSnapshot()

    return res.json({ ok: true, queued: queueResult.queued, taskId: taskPayload.taskId, type })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.post('/api/control/task/preset/:key', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { key } = req.params
    const { targetId = null, ...fields } = req.body || {}
    const taskPayload = buildLegacyTaskFromPreset(key, fields)
    if (!taskPayload) {
      return res.status(404).json({ error: 'preset not found' })
    }

    const targetClients = targetId ? [await getClientById(targetId)].filter(Boolean) : await getClients()
    if (targetClients.length === 0) {
      return res.status(404).json({ error: 'target client not found' })
    }

    const queueResult = await queueLegacyTaskForClients({
      targetClients,
      taskPayload,
      requestedBy: req.user?.username || req.user?.sub || null,
      commandType: `server_task:${key}`,
    })

    await addActivity('warning', `ServerTask preset queued: ${key}`, {
      key,
      type: taskPayload.type,
      targetId: targetId || 'ALL',
      count: queueResult.count,
      taskId: taskPayload.taskId,
      source: 'api',
    })
    await broadcastSnapshot()

    return res.json({
      ok: true,
      key,
      type: taskPayload.type,
      queued: queueResult.queued,
      taskId: taskPayload.taskId,
    })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.get('/api/rco/commands', async (req, res) => {
  try {
    const result = await queryRcoCommandAudit({
      pageNum: req.query.pageNum,
      pageSize: req.query.pageSize,
      status: req.query.status,
      targetId: req.query.targetId,
      deviceId: req.query.deviceId,
      taskId: req.query.taskId,
      type: req.query.type,
      commandType: req.query.commandType,
    })

    return res.json(result)
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.get('/api/schedules', async (_req, res) => {
  try {
    const [media, schedules] = await Promise.all([getMedia(), getSchedules()])
    const mediaById = new Map(media.map((m) => [m.id, m]))
    const withMedia = schedules.map((s) => ({
      ...s,
      mediaName: mediaById.get(s.mediaId)?.name || 'Unknown media',
    }))

    return res.json({ data: withMedia })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.post('/api/schedules', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { targetId = null, mediaId, startAt, repeatMode = 'once', loop = false, volume = 70 } = req.body || {}
    if (!mediaId || !startAt) {
      return res.status(400).json({ error: 'mediaId and startAt are required' })
    }
    if (!['once', 'daily'].includes(repeatMode)) {
      return res.status(400).json({ error: 'repeatMode must be once or daily' })
    }

    const schedule = {
      id: uuidv4(),
      targetId,
      mediaId,
      startAt,
      nextRunAt: startAt,
      repeatMode,
      enabled: true,
      loop: Boolean(loop),
      volume: Number(volume),
      status: 'scheduled',
      lastRunAt: null,
      createdAt: now(),
    }

    assertOk(
      await supabaseAdmin.from('schedules').insert({
        id: schedule.id,
        target_id: schedule.targetId,
        media_id: schedule.mediaId,
        start_at: schedule.startAt,
        next_run_at: schedule.nextRunAt,
        repeat_mode: schedule.repeatMode,
        enabled: schedule.enabled,
        loop: schedule.loop,
        volume: schedule.volume,
        status: schedule.status,
        last_run_at: schedule.lastRunAt,
        created_at: schedule.createdAt,
        updated_at: schedule.createdAt,
      }),
      'create schedule failed'
    )

    await addActivity('info', 'Schedule created', { scheduleId: schedule.id, targetId: targetId || 'ALL' })
    await broadcastSnapshot()

    return res.status(201).json({ data: schedule })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.patch('/api/schedules/:id', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const existing = assertOk(
      await supabaseAdmin.from('schedules').select('*').eq('id', req.params.id).maybeSingle(),
      'load schedule failed'
    )

    if (!existing) return res.status(404).json({ error: 'schedule not found' })

    const current = mapSchedule(existing)
    const next = {
      ...current,
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : current.enabled,
      startAt: req.body?.startAt || current.startAt,
      nextRunAt: req.body?.nextRunAt || current.nextRunAt,
      repeatMode: req.body?.repeatMode || current.repeatMode,
      loop: typeof req.body?.loop === 'boolean' ? req.body.loop : current.loop,
      volume: typeof req.body?.volume === 'number' ? Number(req.body.volume) : current.volume,
      status: req.body?.status || current.status,
    }

    assertOk(
      await supabaseAdmin
        .from('schedules')
        .update({
          start_at: next.startAt,
          next_run_at: next.nextRunAt,
          repeat_mode: next.repeatMode,
          enabled: next.enabled,
          loop: next.loop,
          volume: next.volume,
          status: next.status,
          updated_at: now(),
        })
        .eq('id', next.id),
      'update schedule failed'
    )

    await addActivity('info', 'Schedule updated', { scheduleId: next.id })
    await broadcastSnapshot()

    return res.json({ data: next })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.delete('/api/schedules/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = assertOk(
      await supabaseAdmin.from('schedules').select('id').eq('id', req.params.id).maybeSingle(),
      'load schedule failed'
    )
    if (!existing) return res.status(404).json({ error: 'schedule not found' })

    assertOk(await supabaseAdmin.from('schedules').delete().eq('id', req.params.id), 'delete schedule failed')

    await addActivity('warning', 'Schedule deleted', { scheduleId: req.params.id })
    await broadcastSnapshot()

    return res.status(204).end()
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

let wss = null

function broadcastLocal(payload) {
  if (!wss) return
  const data = JSON.stringify(payload)
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(data)
    }
  }
}

function broadcast(payload) {
  broadcastLocal(payload)
  publishClusterEvent('ws', payload).catch(() => {})
}

function startScheduler() {
  setInterval(async () => {
    try {
      await processDueSchedules()
    } catch (error) {
      await addActivity('error', 'Scheduler tick failed', { error: error.message }).catch(() => {})
    }
  }, 5000)
}

async function bootstrap() {
  await initRedisLayer()
  await initSupabaseState()

  const server = app.listen(PORT, () => {
    console.log(`Control server listening on port ${PORT}`)
  })

  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (socket, req) => {
    const wsUrl = new URL(req.url, `http://${req.headers.host}`)
    const token = wsUrl.searchParams.get('token') || ''

    try {
      jwt.verify(token, JWT_SECRET)
    } catch {
      socket.send(JSON.stringify({ type: 'error', data: { message: 'unauthorized websocket' } }))
      socket.close()
      return
    }

    ;(async () => {
      socket.send(JSON.stringify({ type: 'snapshot', data: await stateSnapshot() }))
      socket.send(JSON.stringify({ type: 'health', data: { status: 'connected', time: now() } }))
    })().catch(() => {
      socket.send(JSON.stringify({ type: 'error', data: { message: 'snapshot init failed' } }))
    })

    socket.on('message', (raw) => {
      try {
        const incoming = JSON.parse(raw.toString())
        if (incoming?.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', data: { time: now() } }))
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', data: { message: 'invalid JSON' } }))
      }
    })
  })

  startScheduler()
}

bootstrap().catch((error) => {
  console.error('Fatal startup error:', error)
  process.exit(1)
})
