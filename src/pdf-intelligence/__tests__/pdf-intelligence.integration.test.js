// pdf-intelligence.integration.test.js
// Integration tests for the complete PDF Intelligence extraction pipeline
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { invoke } from '@tauri-apps/api/core'
import { IntelligenceService } from '../IntelligenceService.js'

// invoke is available via the moduleNameMapper mock

describe('PDF Intelligence Integration Tests', () => {
  let service
  const testPdfPath = '/test/sample.pdf'

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks()

    // Mock window.windowContext with mcpManager
    global.window = global.window || {}
    global.window.windowContext = {
      getComponent: jest.fn((name) => {
        if (name === 'mcpManager') {
          return {
            invokeTool: jest.fn().mockImplementation((server, tool, args) => {
              // Mock MCP responses
              if (tool === 'vision_classify') {
                return Promise.resolve({
                  classifications: {
                    1: { has_visual: true, type: 'diagram' },
                    2: { has_visual: false }
                  }
                })
              }
              if (tool === 'vision_extract') {
                return Promise.resolve({
                  extractions: {
                    1: 'Chart showing Q4 revenue growth of 25%'
                  }
                })
              }
              if (tool === 'summarize') {
                return Promise.resolve({
                  summaries: {
                    1: {
                      notes: ['Key finding 1', 'Key finding 2'],
                      topics: ['revenue', 'growth', 'Q4'],
                      relevancy: 92.5
                    },
                    2: {
                      notes: ['Additional context'],
                      topics: ['context'],
                      relevancy: 78.0
                    }
                  }
                })
              }
              return Promise.reject(new Error(`Unknown tool: ${tool}`))
            })
          }
        }
        return null
      })
    }

    service = new IntelligenceService(testPdfPath)
  })

  afterEach(() => {
    if (global.window && global.window.windowContext) {
      delete global.window.windowContext
    }
  })

  describe('Complete Extraction Pipeline', () => {
    it('should complete full extraction without errors', async () => {
      // Mock Rust extraction response
      invoke.mockImplementation((command, args) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_sample',
            filename: 'sample.pdf',
            totalPages: 2,
            pages: [
              {
                pageNumber: 1,
                text: 'Page 1 content with important data',
                tables: [
                  {
                    columns: ['Q1', 'Q2', 'Q3', 'Q4'],
                    rows: [['100', '150', '200', '250']],
                    bbox: null
                  }
                ],
                images: [
                  {
                    imageIndex: 0,
                    base64Data: 'base64encodedimage',
                    width: 800,
                    height: 600,
                    mimeType: 'image/png'
                  }
                ]
              },
              {
                pageNumber: 2,
                text: 'Page 2 content',
                tables: [],
                images: []
              }
            ],
            metadata: {
              title: 'Sample Document',
              author: 'Test Author',
              created: '2024-01-01'
            }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/sample.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'geminiVision',
        summarization: 'full'
      }

      const result = await service.runExtraction(config)

      // Verify result structure
      expect(result).toBeDefined()
      expect(result.version).toBe('1.0')
      expect(result.sourcePdf).toBe(testPdfPath)
      expect(result.config).toEqual(config)
      expect(result.extraction).toBeDefined()
      expect(result.enrichments).toBeDefined()
      expect(result.processingStats).toBeDefined()

      // Verify extraction was called
      expect(invoke).toHaveBeenCalledWith('extract_pdf_intelligence', {
        pdfPath: testPdfPath,
        config
      })

      // Verify save was called
      expect(invoke).toHaveBeenCalledWith('save_intelligence_result', {
        pdfPath: testPdfPath,
        result: expect.objectContaining({
          version: '1.0',
          sourcePdf: testPdfPath
        })
      })
    })

    it('should track progress through all phases', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_test',
            filename: 'test.pdf',
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                text: 'Test',
                tables: [],
                images: [
                  {
                    imageIndex: 0,
                    base64Data: 'test',
                    width: 100,
                    height: 100,
                    mimeType: 'image/png'
                  }
                ]
              }
            ],
            metadata: { title: 'Test', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/test.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const statusUpdates = []
      service.onStatusChange((event, data) => {
        statusUpdates.push({ event, data })
      })

      const config = {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'geminiVision',
        summarization: 'full'
      }

      await service.runExtraction(config)

      // Verify progress events
      const phases = statusUpdates.filter(u => u.event === 'status').map(u => u.data.phase)
      expect(phases).toContain('extraction')
      expect(phases).toContain('vision')
      expect(phases).toContain('summarization')

      // Verify completion event
      const completeEvents = statusUpdates.filter(u => u.event === 'complete')
      expect(completeEvents).toHaveLength(1)
    })

    it('should handle text-only mode without vision or summarization', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_text',
            filename: 'text.pdf',
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                text: 'Simple text content',
                tables: [],
                images: []
              }
            ],
            metadata: { title: 'Text Doc', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/text.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'textOnly',
        imageDpi: 72,
        visionMode: 'none',
        summarization: 'skip'
      }

      const result = await service.runExtraction(config)

      // Verify no enrichments added
      expect(result.enrichments).toHaveLength(0)
      expect(result.processingStats.visionTimeMs).toBeNull()
      expect(result.processingStats.summarizationTimeMs).toBeNull()
      expect(result.processingStats.pagesWithVision).toBe(0)

      // Verify MCP was not called
      const mcpManager = global.window.windowContext.getComponent('mcpManager')
      expect(mcpManager.invokeTool).not.toHaveBeenCalled()
    })

    it('should handle vision-only mode without summarization', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_vision',
            filename: 'vision.pdf',
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                text: 'Text with image',
                tables: [],
                images: [
                  {
                    imageIndex: 0,
                    base64Data: 'imagedata',
                    width: 400,
                    height: 300,
                    mimeType: 'image/jpeg'
                  }
                ]
              }
            ],
            metadata: { title: 'Vision Test', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/vision.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'ollamaVision',
        summarization: 'skip'
      }

      const result = await service.runExtraction(config)

      // Verify vision enrichments were added
      expect(result.enrichments.length).toBeGreaterThan(0)
      expect(result.enrichments[0].imageText).toBeDefined()
      expect(result.processingStats.visionTimeMs).not.toBeNull()
      expect(result.processingStats.summarizationTimeMs).toBeNull()

      // Verify vision MCP was called but not summarization
      const mcpManager = global.window.windowContext.getComponent('mcpManager')
      const calls = mcpManager.invokeTool.mock.calls
      expect(calls.some(c => c[1] === 'vision_classify')).toBe(true)
      expect(calls.some(c => c[1] === 'vision_extract')).toBe(true)
      expect(calls.some(c => c[1] === 'summarize')).toBe(false)
    })

    it('should handle DeepSeek OCR without classification', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_ocr',
            filename: 'ocr.pdf',
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                text: 'Text',
                tables: [],
                images: [
                  {
                    imageIndex: 0,
                    base64Data: 'ocrimage',
                    width: 600,
                    height: 400,
                    mimeType: 'image/png'
                  }
                ]
              }
            ],
            metadata: { title: 'OCR Test', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/ocr.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'full',
        imageDpi: 200,
        visionMode: 'deepseekOcr',
        summarization: 'skip'
      }

      await service.runExtraction(config)

      // Verify classification was NOT called for DeepSeek
      const mcpManager = global.window.windowContext.getComponent('mcpManager')
      const calls = mcpManager.invokeTool.mock.calls
      expect(calls.some(c => c[1] === 'vision_classify')).toBe(false)
      expect(calls.some(c => c[1] === 'vision_extract')).toBe(true)

      // Verify provider was mapped correctly
      const extractCall = calls.find(c => c[1] === 'vision_extract')
      expect(extractCall[2].provider).toBe('deepseek')
    })

    it('should handle extraction errors gracefully', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.reject(new Error('PDF file not found: /test/missing.pdf'))
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'none',
        summarization: 'skip'
      }

      const errorListener = jest.fn()
      service.onStatusChange(errorListener)

      await expect(service.runExtraction(config)).rejects.toThrow('PDF file not found')

      // Verify error event was emitted
      const errorEvents = errorListener.mock.calls.filter(c => c[0] === 'error')
      expect(errorEvents.length).toBeGreaterThan(0)
    })

    it('should preserve partial results when MCP server is unavailable', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_mcperror',
            filename: 'mcperror.pdf',
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                text: 'Important text content',
                tables: [],
                images: [
                  {
                    imageIndex: 0,
                    base64Data: 'img',
                    width: 100,
                    height: 100,
                    mimeType: 'image/png'
                  }
                ]
              }
            ],
            metadata: { title: 'MCP Error', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/mcperror.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      // Override MCP manager to throw error
      global.window.windowContext.getComponent = jest.fn(() => ({
        invokeTool: jest.fn().mockRejectedValue(new Error('MCP server unavailable'))
      }))

      const config = {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'geminiVision',
        summarization: 'full'
      }

      const partialListener = jest.fn()
      service.onStatusChange(partialListener)

      const result = await service.runExtraction(config)

      // Should have extraction results even though MCP failed
      expect(result).toBeDefined()
      expect(result.extraction).toBeDefined()
      expect(result.extraction.pages[0].text).toBe('Important text content')

      // Should mark as partial with errors
      expect(result.isPartial).toBe(true)
      expect(result.errors).toBeDefined()
      expect(result.errors.length).toBeGreaterThan(0)

      // Should emit partial event, not complete
      const partialEvents = partialListener.mock.calls.filter(c => c[0] === 'partial')
      expect(partialEvents.length).toBeGreaterThan(0)

      // Should still save the partial result
      expect(invoke).toHaveBeenCalledWith('save_intelligence_result', expect.objectContaining({
        pdfPath: testPdfPath,
        result: expect.objectContaining({
          extraction: expect.any(Object),
          isPartial: true
        })
      }))
    })

    it('should show user-friendly error for corrupted PDF', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.reject(new Error('The PDF appears to be corrupted and cannot be processed. Try opening it in a PDF viewer to verify its integrity.'))
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'textOnly',
        imageDpi: 72,
        visionMode: 'none',
        summarization: 'skip'
      }

      await expect(service.runExtraction(config)).rejects.toThrow('corrupted')
    })

    it('should show user-friendly error for password-protected PDF', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.reject(new Error('This PDF is password-protected. Please remove the password protection and try again.'))
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'textOnly',
        imageDpi: 72,
        visionMode: 'none',
        summarization: 'skip'
      }

      await expect(service.runExtraction(config)).rejects.toThrow('password-protected')
    })

    it('should continue with partial results when vision fails but summarization succeeds', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_partial',
            filename: 'partial.pdf',
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                text: 'Test content',
                tables: [],
                images: [
                  {
                    imageIndex: 0,
                    base64Data: 'testimg',
                    width: 100,
                    height: 100,
                    mimeType: 'image/png'
                  }
                ]
              }
            ],
            metadata: { title: 'Partial Test', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/partial.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      // Mock MCP to fail vision but succeed summarization
      global.window.windowContext.getComponent = jest.fn(() => ({
        invokeTool: jest.fn().mockImplementation((server, tool) => {
          if (tool === 'vision_classify' || tool === 'vision_extract') {
            return Promise.reject(new Error('Vision API key invalid'))
          }
          if (tool === 'summarize') {
            return Promise.resolve({
              summaries: {
                1: {
                  notes: ['Summary note'],
                  topics: ['test'],
                  relevancy: 85
                }
              }
            })
          }
          return Promise.reject(new Error(`Unknown tool: ${tool}`))
        })
      }))

      const config = {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'geminiVision',
        summarization: 'full'
      }

      const result = await service.runExtraction(config)

      // Should have extraction and summarization but not vision
      expect(result.extraction).toBeDefined()
      expect(result.enrichments.some(e => e.summaryNotes)).toBe(true)
      expect(result.enrichments.some(e => e.imageText)).toBe(false)
      expect(result.isPartial).toBe(true)
      expect(result.errors.some(e => e.phase.includes('vision'))).toBe(true)
    })

    it('should emit warning events for MCP failures', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_warning',
            filename: 'warning.pdf',
            totalPages: 1,
            pages: [{ pageNumber: 1, text: 'Test', tables: [], images: [] }],
            metadata: { title: 'Warning Test', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/warning.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      global.window.windowContext.getComponent = jest.fn(() => null) // No MCP manager

      const config = {
        mode: 'textOnly',
        imageDpi: 72,
        visionMode: 'geminiVision', // Enabled but will fail
        summarization: 'skip'
      }

      const warningListener = jest.fn()
      service.onStatusChange(warningListener)

      await service.runExtraction(config)

      // Should emit warning event
      const warnings = warningListener.mock.calls.filter(c => c[0] === 'warning')
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0][1].message).toContain('MCP Manager not available')
    })

    it('should correctly merge vision and summarization enrichments', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_merge',
            filename: 'merge.pdf',
            totalPages: 2,
            pages: [
              {
                pageNumber: 1,
                text: 'Page 1',
                tables: [],
                images: [
                  {
                    imageIndex: 0,
                    base64Data: 'img1',
                    width: 100,
                    height: 100,
                    mimeType: 'image/png'
                  }
                ]
              },
              {
                pageNumber: 2,
                text: 'Page 2',
                tables: [],
                images: []
              }
            ],
            metadata: { title: 'Merge Test', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/merge.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'geminiVision',
        summarization: 'full'
      }

      const result = await service.runExtraction(config)

      // Verify enrichments contain both vision and summarization data
      expect(result.enrichments.length).toBeGreaterThan(0)

      // Page 1 should have both vision and summary
      const page1Enrichment = result.enrichments.find(e => e.pageNumber === 1)
      expect(page1Enrichment).toBeDefined()
      expect(page1Enrichment.imageText).toBeDefined()
      expect(page1Enrichment.summaryNotes).toBeDefined()
      expect(page1Enrichment.summaryTopics).toBeDefined()

      // Page 2 should have only summary (no images)
      const page2Enrichment = result.enrichments.find(e => e.pageNumber === 2)
      expect(page2Enrichment).toBeDefined()
      expect(page2Enrichment.summaryNotes).toBeDefined()
    })
  })

  describe('Processing Statistics', () => {
    it('should accurately track extraction time', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          // Simulate extraction delay
          return new Promise(resolve => {
            setTimeout(() => {
              resolve({
                documentId: 'doc_time',
                filename: 'time.pdf',
                totalPages: 1,
                pages: [{ pageNumber: 1, text: 'Test', tables: [], images: [] }],
                metadata: { title: 'Time Test', author: null, created: null }
              })
            }, 100)
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/time.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'textOnly',
        imageDpi: 72,
        visionMode: 'none',
        summarization: 'skip'
      }

      const result = await service.runExtraction(config)

      expect(result.processingStats.extractionTimeMs).toBeGreaterThanOrEqual(100)
    })

    it('should track pages with vision processing', async () => {
      invoke.mockImplementation((command) => {
        if (command === 'extract_pdf_intelligence') {
          return Promise.resolve({
            documentId: 'doc_vision_count',
            filename: 'vision_count.pdf',
            totalPages: 3,
            pages: [
              {
                pageNumber: 1,
                text: 'Page 1',
                tables: [],
                images: [{ imageIndex: 0, base64Data: 'img1', width: 100, height: 100, mimeType: 'image/png' }]
              },
              {
                pageNumber: 2,
                text: 'Page 2',
                tables: [],
                images: []
              },
              {
                pageNumber: 3,
                text: 'Page 3',
                tables: [],
                images: [{ imageIndex: 0, base64Data: 'img3', width: 100, height: 100, mimeType: 'image/png' }]
              }
            ],
            metadata: { title: 'Vision Count', author: null, created: null }
          })
        }
        if (command === 'save_intelligence_result') {
          return Promise.resolve('/test/vision_count.vault.json')
        }
        return Promise.reject(new Error(`Unknown command: ${command}`))
      })

      const config = {
        mode: 'full',
        imageDpi: 144,
        visionMode: 'geminiVision',
        summarization: 'skip'
      }

      const result = await service.runExtraction(config)

      // Should have processed 2 pages with images
      expect(result.processingStats.pagesWithVision).toBe(2)
    })
  })
})
