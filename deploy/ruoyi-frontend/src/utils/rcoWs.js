import { getToken } from '@/utils/auth'

export function createRcoWsClient(options = {}) {
  const {
    wsPath = '/ws',
    reconnectDelayMs = 2500,
    onOpen,
    onClose,
    onError,
    onMessage,
  } = options

  let socket = null
  let closedByUser = false
  let reconnectTimer = null

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function resolveBaseWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}`
  }

  function buildWsUrl() {
    const token = getToken && getToken()
    const base = resolveBaseWsUrl().replace(/\/$/, '')
    const path = wsPath.startsWith('/') ? wsPath : `/${wsPath}`
    if (!token) {
      return `${base}${path}`
    }
    return `${base}${path}?token=${encodeURIComponent(token)}`
  }

  function connect() {
    clearReconnectTimer()
    const url = buildWsUrl()
    socket = new WebSocket(url)

    socket.onopen = () => {
      if (typeof onOpen === 'function') onOpen()
    }

    socket.onclose = () => {
      if (typeof onClose === 'function') onClose()
      if (!closedByUser) {
        reconnectTimer = setTimeout(connect, reconnectDelayMs)
      }
    }

    socket.onerror = (event) => {
      if (typeof onError === 'function') onError(event)
    }

    socket.onmessage = (event) => {
      if (typeof onMessage !== 'function') return
      try {
        const payload = JSON.parse(event.data)
        onMessage(payload)
      } catch {
        onMessage(null)
      }
    }
  }

  function disconnect() {
    closedByUser = true
    clearReconnectTimer()
    if (socket) {
      try {
        socket.close()
      } catch {
        // ignore close errors
      }
      socket = null
    }
  }

  function send(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    socket.send(payload)
    return true
  }

  return {
    connect,
    disconnect,
    send,
    isOpen() {
      return Boolean(socket && socket.readyState === WebSocket.OPEN)
    },
  }
}
