/**
 * @jest-environment jsdom
 */
// ExtractionConfig.test.js - Unit tests for ExtractionConfig dialog
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { ExtractionConfig } from '../ExtractionConfig.js'

describe('ExtractionConfig', () => {
  let dialog
  let onSubmitMock

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = ''

    // Mock callback
    onSubmitMock = jest.fn()

    // Create dialog instance
    dialog = new ExtractionConfig({
      onSubmit: onSubmitMock
    })
  })

  afterEach(() => {
    // Cleanup
    if (dialog) {
      dialog.close()
    }
    document.body.innerHTML = ''
  })

  describe('constructor', () => {
    it('should initialize with onSubmit callback', () => {
      expect(dialog.onSubmit).toBe(onSubmitMock)
      expect(dialog.container).toBeNull()
    })
  })

  describe('show()', () => {
    it('should create dialog in DOM', () => {
      dialog.show()

      expect(dialog.container).not.toBeNull()
      expect(document.body.contains(dialog.container)).toBe(true)

      const dialogElement = document.querySelector('.intelligence-config-dialog')
      expect(dialogElement).not.toBeNull()
    })

    it('should display all configuration sections', () => {
      dialog.show()

      // Check for all sections
      expect(document.querySelector('input[name="mode"]')).not.toBeNull()
      expect(document.querySelector('input[name="dpi"]')).not.toBeNull()
      expect(document.querySelector('input[name="vision"]')).not.toBeNull()
      expect(document.querySelector('input[name="summarization"]')).not.toBeNull()
    })

    it('should have correct default selections', () => {
      dialog.show()

      // Extraction Mode: Full should be checked
      expect(document.querySelector('input[name="mode"][value="full"]').checked).toBe(true)

      // Image DPI: 144 should be checked
      expect(document.querySelector('input[name="dpi"][value="144"]').checked).toBe(true)

      // Vision: None should be checked
      expect(document.querySelector('input[name="vision"][value="none"]').checked).toBe(true)

      // Summarization: Skip should be checked
      expect(document.querySelector('input[name="summarization"][value="skip"]').checked).toBe(true)
    })

    it('should display badges for free, premium, and local options', () => {
      dialog.show()

      const freeBadges = document.querySelectorAll('.badge-free')
      const premiumBadges = document.querySelectorAll('.badge-premium')
      const localBadges = document.querySelectorAll('.badge-local')

      expect(freeBadges.length).toBeGreaterThan(0)
      expect(premiumBadges.length).toBeGreaterThan(0)
      expect(localBadges.length).toBeGreaterThan(0)
    })
  })

  describe('close()', () => {
    it('should remove dialog from DOM', () => {
      dialog.show()
      expect(dialog.container).not.toBeNull()

      dialog.close()

      expect(dialog.container).toBeNull()
      expect(document.querySelector('.intelligence-config-overlay')).toBeNull()
    })

    it('should handle multiple close calls gracefully', () => {
      dialog.show()
      dialog.close()
      dialog.close() // Should not throw

      expect(dialog.container).toBeNull()
    })
  })

  describe('submit()', () => {
    it('should call onSubmit with correct config object', () => {
      dialog.show()

      // Click submit
      const submitBtn = document.querySelector('.dialog-submit-btn')
      submitBtn.click()

      expect(onSubmitMock).toHaveBeenCalledTimes(1)

      const config = onSubmitMock.mock.calls[0][0]
      expect(config).toEqual({
        mode: 'full',
        imageDpi: 144,
        visionMode: 'none',
        summarization: 'skip'
      })
    })

    it('should close dialog after submit', () => {
      dialog.show()

      const submitBtn = document.querySelector('.dialog-submit-btn')
      submitBtn.click()

      expect(dialog.container).toBeNull()
    })

    it('should submit with selected configuration', () => {
      dialog.show()

      // Select different options
      document.querySelector('input[name="mode"][value="textOnly"]').click()
      document.querySelector('input[name="dpi"][value="300"]').click()
      document.querySelector('input[name="vision"][value="geminiVision"]').click()
      document.querySelector('input[name="summarization"][value="full"]').click()

      // Submit
      const submitBtn = document.querySelector('.dialog-submit-btn')
      submitBtn.click()

      const config = onSubmitMock.mock.calls[0][0]
      expect(config).toEqual({
        mode: 'textOnly',
        imageDpi: 300,
        visionMode: 'geminiVision',
        summarization: 'full'
      })
    })
  })

  describe('radio groups', () => {
    it('should have mutually exclusive extraction mode options', () => {
      dialog.show()

      const fullRadio = document.querySelector('input[name="mode"][value="full"]')
      const textOnlyRadio = document.querySelector('input[name="mode"][value="textOnly"]')

      expect(fullRadio.checked).toBe(true)
      expect(textOnlyRadio.checked).toBe(false)

      textOnlyRadio.click()

      expect(fullRadio.checked).toBe(false)
      expect(textOnlyRadio.checked).toBe(true)
    })

    it('should have mutually exclusive vision options', () => {
      dialog.show()

      const noneRadio = document.querySelector('input[name="vision"][value="none"]')
      const geminiRadio = document.querySelector('input[name="vision"][value="geminiVision"]')

      expect(noneRadio.checked).toBe(true)
      expect(geminiRadio.checked).toBe(false)

      geminiRadio.click()

      expect(noneRadio.checked).toBe(false)
      expect(geminiRadio.checked).toBe(true)
    })
  })

  describe('image config visibility', () => {
    it('should show image config for full mode', () => {
      dialog.show()

      document.querySelector('input[name="mode"][value="full"]').click()

      const imageConfig = document.getElementById('image-config')
      expect(imageConfig.style.display).not.toBe('none')
    })

    it('should show image config for textAndImages mode', () => {
      dialog.show()

      document.querySelector('input[name="mode"][value="textAndImages"]').click()

      const imageConfig = document.getElementById('image-config')
      expect(imageConfig.style.display).not.toBe('none')
    })

    it('should hide image config for textOnly mode', () => {
      dialog.show()

      document.querySelector('input[name="mode"][value="textOnly"]').click()

      const imageConfig = document.getElementById('image-config')
      expect(imageConfig.style.display).toBe('none')
    })
  })

  describe('cancel button', () => {
    it('should close dialog without calling onSubmit', () => {
      dialog.show()

      const cancelBtn = document.querySelector('.dialog-cancel-btn')
      cancelBtn.click()

      expect(onSubmitMock).not.toHaveBeenCalled()
      expect(dialog.container).toBeNull()
    })
  })

  describe('close button', () => {
    it('should close dialog when X button clicked', () => {
      dialog.show()

      const closeBtn = document.querySelector('.dialog-close-btn')
      closeBtn.click()

      expect(dialog.container).toBeNull()
    })
  })

  describe('overlay click', () => {
    it('should close dialog when clicking overlay background', () => {
      dialog.show()

      const overlay = document.querySelector('.intelligence-config-overlay')
      overlay.click()

      expect(dialog.container).toBeNull()
    })

    it('should not close when clicking dialog content', () => {
      dialog.show()

      const dialogContent = document.querySelector('.intelligence-config-dialog')
      dialogContent.click()

      expect(dialog.container).not.toBeNull()
    })
  })
})
