import request from '@/utils/request'

export function sendScreenCommand(data) {
  return request({
    url: '/system/rco/screen',
    method: 'post',
    data,
  })
}

export function sendServerTask(data) {
  return request({
    url: '/system/rco/task',
    method: 'post',
    data,
  })
}

export function listTaskPresets() {
  return request({
    url: '/system/rco/task/presets',
    method: 'get',
  })
}

export function sendTaskPreset(key, data) {
  return request({
    url: `/system/rco/task/preset/${key}`,
    method: 'post',
    data,
  })
}

export function listCommandAudit(query) {
  return request({
    url: '/system/rco/command/list',
    method: 'get',
    params: query,
  })
}
