// IntelligenceService.test.js - Unit tests for IntelligenceService
import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// Import service (invoke is mocked via moduleNameMapper)
import { IntelligenceService } from '../IntelligenceService.js'

describe('IntelligenceService', () => {
  let service
  const testPdfPath = '/test/document.pdf'

  beforeEach(() => {
    global.window = global.window || {}
  })

  describe('constructor', () => {
    it('should initialize with PDF path', () => {
      service = new IntelligenceService(testPdfPath)

      expect(service.pdfPath).toBe(testPdfPath)
      expect(service.result).toBeNull()
      expect(service.listeners).toBeInstanceOf(Set)
    })
  })

  describe('onStatusChange', () => {
    beforeEach(() => {
      service = new IntelligenceService(testPdfPath)
    })

    it('should register listener and return unsubscribe function', () => {
      const listener = jest.fn()
      const unsubscribe = service.onStatusChange(listener)

      expect(service.listeners.has(listener)).toBe(true)
      expect(typeof unsubscribe).toBe('function')

      // Test unsubscribe
      unsubscribe()
      expect(service.listeners.has(listener)).toBe(false)
    })

    it('should emit events to all registered listeners', () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      service.onStatusChange(listener1)
      service.onStatusChange(listener2)

      service.emit('test-event', { data: 'test' })

      expect(listener1).toHaveBeenCalledWith('test-event', { data: 'test' })
      expect(listener2).toHaveBeenCalledWith('test-event', { data: 'test' })
    })
  })

  describe('emit', () => {
    beforeEach(() => {
      service = new IntelligenceService(testPdfPath)
    })

    it('should call all listeners with event data', () => {
      const listener = jest.fn()
      service.listeners.add(listener)

      service.emit('status', { phase: 'extraction', progress: 50 })

      expect(listener).toHaveBeenCalledWith('status', { phase: 'extraction', progress: 50 })
    })
  })
})
