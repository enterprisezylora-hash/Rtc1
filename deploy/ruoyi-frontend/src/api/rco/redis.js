import request from '@/utils/request'

export function getRedisHealth() {
  return request({
    url: '/api/redis/health',
    method: 'get',
  })
}

export function getRedisQueueStats() {
  return request({
    url: '/api/redis/queue-stats',
    method: 'get',
  })
}
