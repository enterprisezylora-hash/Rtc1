import request from '@/utils/request'

export function listMedia(query) {
  return request({
    url: '/system/rco/media/list',
    method: 'get',
    params: query,
  })
}

export function getMedia(id) {
  return request({
    url: `/system/rco/media/${id}`,
    method: 'get',
  })
}

export function addMedia(data) {
  return request({
    url: '/system/rco/media',
    method: 'post',
    data,
  })
}

export function uploadMedia(formData) {
  return request({
    url: '/system/rco/media/upload',
    method: 'post',
    data: formData,
  })
}

export function updateMedia(data) {
  return request({
    url: '/system/rco/media',
    method: 'put',
    data,
  })
}

export function delMedia(ids) {
  return request({
    url: `/system/rco/media/${ids}`,
    method: 'delete',
  })
}
