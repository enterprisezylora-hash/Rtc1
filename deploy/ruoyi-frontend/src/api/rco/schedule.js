import request from '@/utils/request'

export function listSchedule(query) {
  return request({
    url: '/system/rco/schedule/list',
    method: 'get',
    params: query,
  })
}

export function getSchedule(id) {
  return request({
    url: `/system/rco/schedule/${id}`,
    method: 'get',
  })
}

export function addSchedule(data) {
  return request({
    url: '/system/rco/schedule',
    method: 'post',
    data,
  })
}

export function updateSchedule(data) {
  return request({
    url: '/system/rco/schedule',
    method: 'put',
    data,
  })
}

export function delSchedule(ids) {
  return request({
    url: `/system/rco/schedule/${ids}`,
    method: 'delete',
  })
}
