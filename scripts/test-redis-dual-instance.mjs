#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const ROOT = process.cwd()
const ENV_FILE = `${ROOT}/.env.server`

function parseEnvFile(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const fileEnv = parseEnvFile(ENV_FILE)
const HOST = process.env.TEST_HOST || 'api.internal'
const PORT_A = Number(process.env.TEST_PORT_A || 8891)
const PORT_B = Number(process.env.TEST_PORT_B || 8892)
const USERNAME = process.env.TEST_USERNAME || process.env.ADMIN_USERNAME || fileEnv.ADMIN_USERNAME || 'admin'
const PASSWORD = process.env.TEST_PASSWORD || process.env.ADMIN_PASSWORD || fileEnv.ADMIN_PASSWORD || 'admin123'
const START_TIMEOUT_MS = Number(process.env.TEST_START_TIMEOUT_MS || 25000)
const EVENT_TIMEOUT_MS = Number(process.env.TEST_EVENT_TIMEOUT_MS || 15000)
const START_MAX_RETRY = Number(process.env.TEST_START_MAX_RETRY || 4)

const INSTANCE_A = `instance-A-${randomUUID().slice(0, 8)}`
const INSTANCE_B = `instance-B-${randomUUID().slice(0, 8)}`

const servers = []

function startServer(port, instanceId) {
  const env = {
    ...process.env,
    PORT: String(port),
    INSTANCE_ID: instanceId,
  }

  const child = spawn('node', ['--env-file=.env.server', 'server/index.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (buf) => {
    process.stdout.write(`[${instanceId}] ${buf.toString()}`)
  })
  child.stderr.on('data', (buf) => {
    process.stderr.write(`[${instanceId}] ${buf.toString()}`)
  })

  servers.push(child)
  return child
}

async function waitForHealthyServer(baseUrl, port, instanceId) {
  let attempt = 1
  while (attempt <= START_MAX_RETRY) {
    const child = startServer(port, instanceId)
    try {
      const health = await waitForHealth(baseUrl, START_TIMEOUT_MS)
      return { child, health }
    } catch (error) {
      const exitCode = child.exitCode
      if (!child.killed) {
        child.kill('SIGTERM')
      }
      if (attempt >= START_MAX_RETRY) {
        throw new Error(
          `failed to start ${instanceId} after ${START_MAX_RETRY} attempts: ${error.message}${
            exitCode !== null ? ` (exit=${exitCode})` : ''
          }`
        )
      }
      console.warn(`Retry startup ${instanceId} (attempt ${attempt}/${START_MAX_RETRY}) due to: ${error.message}`)
      await delay(1500)
      attempt += 1
    }
  }

  throw new Error(`unexpected startup loop termination for ${instanceId}`)
}

async function requestJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    })
    const data = await response.json().catch(() => ({}))
    return { response, data }
  } finally {
    clearTimeout(timer)
  }
}

async function waitForHealth(baseUrl, timeoutMs) {
  const started = Date.now()
  let lastError = 'unknown'

  while (Date.now() - started < timeoutMs) {
    try {
      const { response, data } = await requestJson(`${baseUrl}/api/health`, { method: 'GET' }, 2500)
      if (response.ok && data?.status === 'ok') {
        return data
      }
      lastError = `health not ready: status=${response.status}`
    } catch (error) {
      lastError = error.message
    }
    await delay(700)
  }

  throw new Error(`timeout waiting health ${baseUrl}: ${lastError}`)
}

async function loginRuoyi(baseUrl) {
  const { response, data } = await requestJson(
    `${baseUrl}/login`,
    {
      method: 'POST',
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    },
    10000
  )

  if (!response.ok || data?.code !== 200 || !data?.token) {
    throw new Error(`login failed at ${baseUrl}: status=${response.status}, body=${JSON.stringify(data)}`)
  }

  return data.token
}

async function registerClient(baseUrl, token) {
  const payload = {
    name: `dual-test-${Date.now()}`,
    type: 'android',
  }

  const { response, data } = await requestJson(
    `${baseUrl}/api/clients/register`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    10000
  )

  if (!response.ok || !data?.data?.id) {
    throw new Error(`client register failed: status=${response.status}, body=${JSON.stringify(data)}`)
  }

  return data.data
}

async function sendTask(baseUrl, token, targetId) {
  const { response, data } = await requestJson(
    `${baseUrl}/system/rco/task`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetId, type: 10049, msg: 'dual-instance redis verification' }),
    },
    10000
  )

  if (!response.ok || data?.code !== 200) {
    throw new Error(`send task failed: status=${response.status}, body=${JSON.stringify(data)}`)
  }

  return data
}

async function getQueueStats(baseUrl, token) {
  const { response, data } = await requestJson(
    `${baseUrl}/api/redis/queue-stats`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
    10000
  )

  if (!response.ok) {
    throw new Error(`queue stats failed: status=${response.status}, body=${JSON.stringify(data)}`)
  }

  return data
}

function waitForRemoteStatusEvent(baseWsUrl, token, expectedInstanceId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseWsUrl}/ws?token=${encodeURIComponent(token)}`)
    let timeoutHandle = null

    const finish = (err, payload) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      try {
        ws.close()
      } catch {
        // ignore close errors in cleanup
      }
      if (err) reject(err)
      else resolve(payload)
    }

    ws.on('open', () => {
      timeoutHandle = setTimeout(() => {
        finish(new Error(`timeout waiting rco-status event from remote instance: ${expectedInstanceId}`))
      }, timeoutMs)
    })

    ws.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (message?.type !== 'rco-status') return
      const event = message?.data || {}
      if (event.instanceId === expectedInstanceId && event.status === 'queued') {
        finish(null, event)
      }
    })

    ws.on('error', (error) => {
      finish(new Error(`websocket error: ${error.message}`))
    })
  })
}

function cleanupServers() {
  for (const child of servers) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }
}

process.on('SIGINT', () => {
  cleanupServers()
  process.exit(130)
})

process.on('SIGTERM', () => {
  cleanupServers()
  process.exit(143)
})

async function main() {
  const baseA = `http://${HOST}:${PORT_A}`
  const baseB = `http://${HOST}:${PORT_B}`
  const wsB = `ws://${HOST}:${PORT_B}`

  console.log('Starting dual instances...')

  try {
    const { health: healthA } = await waitForHealthyServer(baseA, PORT_A, INSTANCE_A)
    const { health: healthB } = await waitForHealthyServer(baseB, PORT_B, INSTANCE_B)

    console.log('Health A:', JSON.stringify(healthA.redis || {}))
    console.log('Health B:', JSON.stringify(healthB.redis || {}))

    const token = await loginRuoyi(baseA)
    const client = await registerClient(baseA, token)

    const eventPromise = waitForRemoteStatusEvent(wsB, token, INSTANCE_A, EVENT_TIMEOUT_MS)

    const taskResponse = await sendTask(baseA, token, client.id)
    const statusEvent = await eventPromise

    const [statsA, statsB] = await Promise.all([getQueueStats(baseA, token), getQueueStats(baseB, token)])

    if (!statsA?.ready || !statsB?.ready) {
      throw new Error(`redis not ready on both instances: A=${JSON.stringify(statsA)}, B=${JSON.stringify(statsB)}`)
    }

    console.log('Task queued:', JSON.stringify({ taskId: taskResponse.taskId, queued: taskResponse.queued, type: taskResponse.type }))
    console.log('Remote status event on B:', JSON.stringify(statusEvent))
    console.log('Queue stats A:', JSON.stringify(statsA))
    console.log('Queue stats B:', JSON.stringify(statsB))
    console.log('PASS: dual-instance Redis pub/sub and queue mirror verified.')
  } finally {
    cleanupServers()
  }
}

main().catch((error) => {
  console.error('FAIL:', error.message)
  cleanupServers()
  process.exit(1)
})
