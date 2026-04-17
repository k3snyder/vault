import { jest } from '@jest/globals'

export const basename = jest.fn(async (filePath = '') => filePath.split('/').pop() || '')
export const dirname = jest.fn(async (filePath = '') => {
  const parts = filePath.split('/')
  parts.pop()
  return parts.join('/') || '.'
})
export const join = jest.fn(async (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'))

export default {
  basename,
  dirname,
  join
}
