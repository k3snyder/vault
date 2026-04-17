import { jest } from '@jest/globals'

export const invoke = jest.fn()
export const emit = jest.fn()
export const listen = jest.fn(async () => jest.fn())
export const once = jest.fn(async () => jest.fn())
export const convertFileSrc = jest.fn((path) => path)
export const check = jest.fn(async () => true)
export const request = jest.fn(async () => 'granted')

export class Channel {
  constructor(onMessage) {
    this.onmessage = onMessage
  }

  send(message) {
    this.onmessage?.(message)
  }
}

export const core = {
  invoke
}

export default {
  invoke,
  emit,
  listen,
  once,
  convertFileSrc,
  check,
  request,
  Channel,
  core
}
