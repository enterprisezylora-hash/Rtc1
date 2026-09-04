import request from '@/utils/request'

export function listClient(query) {
  return request({
    url: '/system/rco/client/list',
    method: 'get',
    params: query,
  })
}

export function getClient(id) {
  return request({
    url: `/system/rco/client/${id}`,
    method: 'get',
  })
}

export function addClient(data) {
  return request({
    url: '/system/rco/client',
    method: 'post',
    data,
  })
}

export function updateClient(data) {
  return request({
    url: '/system/rco/client',
    method: 'put',
    data,
  })
}

export function delClient(ids) {
  return request({
    url: `/system/rco/client/${ids}`,
    method: 'delete',
  })
}
