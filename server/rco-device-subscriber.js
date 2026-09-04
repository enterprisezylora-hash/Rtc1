import { createClient } from '@supabase/supabase-js'
import { createClient as createRedisClient } from 'redis'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const DEVICE_EXTERNAL_ID = process.env.RCO_DEVICE_EXTERNAL_ID || 'device-001'
const DEVICE_DISPLAY_NAME = process.env.RCO_DEVICE_DISPLAY_NAME || `Device ${DEVICE_EXTERNAL_ID}`
const DEVICE_PLATFORM = process.env.RCO_DEVICE_PLATFORM || 'android'
const REDIS_URL = process.env.REDIS_URL || 'redis://redis.internal:6379'
const REDIS_ENABLED = String(process.env.REDIS_ENABLED || 'true') !== 'false'
const REDIS_STATUS_CHANNEL = process.env.REDIS_STATUS_CHANNEL || 'rco:status:events'
const INSTANCE_ID = process.env.INSTANCE_ID || `subscriber-${DEVICE_EXTERNAL_ID}`

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('[rco-subscriber] Missing SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const redisPub = REDIS_ENABLED ? createRedisClient({ url: REDIS_URL }) : null
let redisReady = false

function now() {
  return new Date().toISOString()
}

async function ensureDevice() {
  const payload = {
    external_device_id: DEVICE_EXTERNAL_ID,
    display_name: DEVICE_DISPLAY_NAME,
    platform: DEVICE_PLATFORM,
    is_online: true,
    last_seen_at: now(),
    metadata: {
      source: 'rco-device-subscriber',
    },
  }

  const { data, error } = await supabase
    .from('rco_devices')
    .upsert(payload, { onConflict: 'external_device_id' })
    .select('id, external_device_id, display_name')
    .single()

  if (error) {
    throw new Error(`ensureDevice failed: ${error.message}`)
  }

  return data
}

async function markDeviceOnline(deviceId) {
  const { error } = await supabase
    .from('rco_devices')
    .update({
      is_online: true,
      last_seen_at: now(),
      updated_at: now(),
    })
    .eq('id', deviceId)

  if (error) {
    console.warn('[rco-subscriber] Failed heartbeat update:', error.message)
  }
}

async function appendCommandLog(command, eventType, payload) {
  const { error } = await supabase.from('rco_command_logs').insert({
    command_id: command.id,
    device_id: command.device_id,
    event_type: eventType,
    event_payload: payload,
  })

  if (error) {
    console.warn('[rco-subscriber] Failed log insert:', error.message)
  }
}

async function updateCommandStatus(commandId, status, extra = {}) {
  const patch = {
    status,
    updated_at: now(),
    ...extra,
  }

  const { error } = await supabase.from('rco_commands').update(patch).eq('id', commandId)

  if (error) {
    throw new Error(`updateCommandStatus failed: ${error.message}`)
  }
}

async function publishStatusEvent(command, status, extra = {}) {
  if (!redisReady || !redisPub) return
  const payload = {
    instanceId: INSTANCE_ID,
    commandId: command.id,
    deviceId: command.device_id,
    commandType: command.command_type,
    status,
    taskId: command.payload?.taskId || null,
    type: command.payload?.type ?? null,
    at: now(),
    ...extra,
  }
  await redisPub.publish(REDIS_STATUS_CHANNEL, JSON.stringify(payload))
}

async function handleCommand(command) {
  console.log('[rco-subscriber] command received:', {
    id: command.id,
    commandType: command.command_type,
    payload: command.payload,
  })

  await updateCommandStatus(command.id, 'sent', { sent_at: now() })
  await appendCommandLog(command, 'sent', { at: now(), note: 'Device received command' })
  await publishStatusEvent(command, 'sent')

  // Simulate command execution. Replace this block with real device action execution.
  await updateCommandStatus(command.id, 'acked', { acked_at: now(), error_message: null })
  await appendCommandLog(command, 'acked', { at: now(), note: 'Device acknowledged command' })
  await publishStatusEvent(command, 'acked')
}

async function bootstrap() {
  if (REDIS_ENABLED && redisPub) {
    try {
      redisPub.on('error', (error) => console.error('[rco-subscriber] redis error:', error.message))
      await redisPub.connect()
      redisReady = true
      console.log('[rco-subscriber] redis connected:', REDIS_URL)
    } catch (error) {
      redisReady = false
      console.warn('[rco-subscriber] redis disabled due to connect error:', error.message)
    }
  }

  const device = await ensureDevice()
  console.log('[rco-subscriber] online as device:', device)

  await markDeviceOnline(device.id)
  setInterval(() => {
    markDeviceOnline(device.id).catch(() => {})
  }, 15000)

  const channel = supabase
    .channel(`rco-device-${DEVICE_EXTERNAL_ID}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'rco_commands',
        filter: `device_id=eq.${device.id}`,
      },
      async (payload) => {
        const command = payload.new
        try {
          await handleCommand(command)
        } catch (error) {
          console.error('[rco-subscriber] command failed:', error.message)
          await updateCommandStatus(command.id, 'failed', { error_message: error.message }).catch(() => {})
          await appendCommandLog(command, 'failed', { at: now(), error: error.message }).catch(() => {})
          await publishStatusEvent(command, 'failed', { error: error.message }).catch(() => {})
        }
      }
    )
    .subscribe((status) => {
      console.log('[rco-subscriber] realtime status:', status)
    })

  process.on('SIGINT', async () => {
    console.log('\n[rco-subscriber] shutting down...')
    await supabase.removeChannel(channel)
    await supabase
      .from('rco_devices')
      .update({ is_online: false, last_seen_at: now(), updated_at: now() })
      .eq('id', device.id)
      .catch(() => {})
    process.exit(0)
  })
}

bootstrap().catch((error) => {
  console.error('[rco-subscriber] fatal:', error.message)
  process.exit(1)
})
