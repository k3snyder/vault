// File Generator Tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileGenerator } from './file-generator';
import type { VaultAPI } from '@vault/plugin-api';
import type { ReadwiseSettings, ReadwiseExport, ReadwiseHighlight } from './types';
import Mustache from 'mustache';

// Mock Vault API
const mockVault: VaultAPI = {
  read: vi.fn(),
  write: vi.fn(),
  append: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  list: vi.fn(),
  search: vi.fn(),
  getMetadata: vi.fn(),
  setMetadata: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  listNotes: vi.fn(),
  searchNotes: vi.fn()
};

const defaultSettings: ReadwiseSettings = {
  apiToken: 'test-token',
  syncFrequency: 60,
  autoSync: false,
  syncOnStartup: false,
  highlightsFolder: 'Readwise',
  dateFormat: 'YYYY-MM-DD',
  groupBy: 'book',
  appendToExisting: true,
  includeSupplementals: true
};

describe('FileGenerator', () => {
  let fileGenerator: FileGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    fileGenerator = new FileGenerator(mockVault, defaultSettings);
  });

  describe('Template Processing', () => {
    it('should use default template when no custom template provided', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Test Book',
        author: 'Test Author',
        category: 'books',
        highlights: [
          {
            id: 1,
            text: 'Test highlight',
            note: 'Test note',
            location: 100
          }
        ]
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.write).toHaveBeenCalledWith(
        'Readwise/Test Book.md',
        expect.stringContaining('# Test Book')
      );
      expect(mockVault.write).toHaveBeenCalledWith(
        'Readwise/Test Book.md',
        expect.stringContaining('Author: Test Author')
      );
      expect(mockVault.write).toHaveBeenCalledWith(
        'Readwise/Test Book.md',
        expect.stringContaining('> Test highlight')
      );
    });

    it('should use custom template when provided', async () => {
      const customTemplate = '# {{title}} by {{author}}\n{{#highlights}}* {{text}}\n{{/highlights}}';
      const settings = { ...defaultSettings, customTemplate };
      fileGenerator = new FileGenerator(mockVault, settings);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Custom Book',
        author: 'Custom Author',
        highlights: [
          { id: 1, text: 'Highlight 1' },
          { id: 2, text: 'Highlight 2' }
        ]
      };

      await fileGenerator.generateFile(exportData);

      const expectedContent = '# Custom Book by Custom Author\n* Highlight 1\n* Highlight 2\n';
      expect(mockVault.write).toHaveBeenCalledWith(
        'Readwise/Custom Book.md',
        expectedContent
      );
    });

    it('should handle missing optional fields gracefully', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Minimal Book',
        highlights: [
          { id: 1, text: 'Simple highlight' }
        ]
      };

      await fileGenerator.generateFile(exportData);

      const writeCalls = mockVault.write.mock.calls[0];
      const content = writeCalls[1];
      
      expect(content).toContain('# Minimal Book');
      expect(content).not.toContain('Author: undefined');
      expect(content).toContain('> Simple highlight');
    });

    it('should escape special Mustache characters', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Book with {{special}} characters',
        highlights: [
          { id: 1, text: 'Text with {{mustache}} syntax' }
        ]
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.write).toHaveBeenCalled();
      const content = mockVault.write.mock.calls[0][1];
      expect(content).toContain('Book with {{special}} characters');
    });
  });

  describe('Frontmatter Generation', () => {
    it('should generate complete frontmatter with all metadata', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 123,
        title: 'Complete Book',
        author: 'John Doe',
        category: 'articles',
        source: 'kindle',
        unique_url: 'https://example.com/book',
        book_tags: [
          { id: 1, name: 'philosophy' },
          { id: 2, name: 'science' }
        ],
        highlights: Array(5).fill({ id: 1, text: 'test' })
      };

      await fileGenerator.generateFile(exportData);

      const content = mockVault.write.mock.calls[0][1];
      
      expect(content).toContain('title: Complete Book');
      expect(content).toContain('author: John Doe');
      expect(content).toContain('category: articles');
      expect(content).toContain('source: kindle');
      expect(content).toContain('url: https://example.com/book');
      expect(content).toContain('tags: #philosophy #science');
      expect(content).toContain('highlights: 5');
    });

    it('should format date correctly in frontmatter', async () => {
      const settings = { ...defaultSettings, dateFormat: 'MM/DD/YYYY' };
      fileGenerator = new FileGenerator(mockVault, settings);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Date Test',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      const content = mockVault.write.mock.calls[0][1];
      const dateRegex = /date: (\d{2}\/\d{2}\/\d{4})/;
      expect(content).toMatch(dateRegex);
    });

    it('should handle empty tags array', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'No Tags Book',
        book_tags: [],
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      const content = mockVault.write.mock.calls[0][1];
      expect(content).not.toContain('tags: #');
    });
  });

  describe('Stable Block ID System', () => {
    it('should generate stable IDs for highlights', async () => {
      const highlight: ReadwiseHighlight = {
        id: 123,
        text: 'Test highlight',
        note: 'Test note',
        location: 100
      };

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'ID Test',
        highlights: [highlight]
      };

      await fileGenerator.generateFile(exportData);

      const content = mockVault.write.mock.calls[0][1];
      expect(content).toContain('<!-- readwise-id: 123 -->');
    });

    it('should generate content hash for duplicate detection', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Hash Test',
        highlights: [
          {
            id: 1,
            text: 'Unique text for hashing',
            note: 'Unique note'
          }
        ]
      };

      await fileGenerator.generateFile(exportData);

      const content = mockVault.write.mock.calls[0][1];
      expect(content).toMatch(/<!-- readwise-hash: [a-f0-9]{16} -->/);
    });

    it('should maintain IDs across updates', async () => {
      const existingContent = `
# Test Book
## Highlights
<!-- readwise-id: 123 -->
> Existing highlight
<!-- readwise-hash: abc123 -->
`;

      mockVault.exists.mockResolvedValue(true);
      mockVault.read.mockResolvedValue(existingContent);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Test Book',
        highlights: [
          { id: 123, text: 'Existing highlight' }, // Same
          { id: 124, text: 'New highlight' } // New
        ]
      };

      const settings = { ...defaultSettings, appendToExisting: true };
      fileGenerator = new FileGenerator(mockVault, settings);

      await fileGenerator.generateFile(exportData);

      expect(mockVault.append).toHaveBeenCalled();
      const appendedContent = mockVault.append.mock.calls[0][1];
      expect(appendedContent).toContain('<!-- readwise-id: 124 -->');
      expect(appendedContent).not.toContain('<!-- readwise-id: 123 -->');
    });
  });

  describe('File Organization', () => {
    it('should organize by book (default)', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Book Title',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.write).toHaveBeenCalledWith(
        'Readwise/Book Title.md',
        expect.any(String)
      );
    });

    it('should organize by article type', async () => {
      const settings = { ...defaultSettings, groupBy: 'article' as const };
      fileGenerator = new FileGenerator(mockVault, settings);

      const articleExport: ReadwiseExport = {
        user_book_id: 1,
        title: 'Article Title',
        category: 'articles',
        highlights: []
      };

      await fileGenerator.generateFile(articleExport);

      expect(mockVault.write).toHaveBeenCalledWith(
        'Readwise/Articles/Article Title.md',
        expect.any(String)
      );
    });

    it('should organize by category', async () => {
      const settings = { ...defaultSettings, groupBy: 'category' as const };
      fileGenerator = new FileGenerator(mockVault, settings);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Categorized Book',
        category: 'philosophy',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.write).toHaveBeenCalledWith(
        'Readwise/philosophy/Categorized Book.md',
        expect.any(String)
      );
    });

    it('should organize by date', async () => {
      const settings = { ...defaultSettings, groupBy: 'date' as const };
      fileGenerator = new FileGenerator(mockVault, settings);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Dated Book',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      
      expect(mockVault.write).toHaveBeenCalledWith(
        `Readwise/${year}/${month}/Dated Book.md`,
        expect.any(String)
      );
    });

    it('should sanitize filenames', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Book: With <Special> Characters? | Yes!',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.write).toHaveBeenCalledWith(
        'Readwise/Book With Special Characters Yes!.md',
        expect.any(String)
      );
    });

    it('should limit filename length', async () => {
      const longTitle = 'A'.repeat(250);
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: longTitle,
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      const filename = mockVault.write.mock.calls[0][0];
      expect(filename.length).toBeLessThanOrEqual(250);
    });
  });

  describe('Append vs Overwrite Logic', () => {
    it('should append to existing file when enabled', async () => {
      mockVault.exists.mockResolvedValue(true);
      mockVault.read.mockResolvedValue('# Existing Content\n');

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Append Test',
        highlights: [
          { id: 1, text: 'New highlight' }
        ]
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.append).toHaveBeenCalled();
      expect(mockVault.write).not.toHaveBeenCalled();
    });

    it('should overwrite file when append disabled', async () => {
      const settings = { ...defaultSettings, appendToExisting: false };
      fileGenerator = new FileGenerator(mockVault, settings);

      mockVault.exists.mockResolvedValue(true);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Overwrite Test',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.write).toHaveBeenCalled();
      expect(mockVault.append).not.toHaveBeenCalled();
    });

    it('should skip duplicate highlights when appending', async () => {
      const existingContent = `
# Book
## Highlights
<!-- readwise-id: 1 -->
> Existing highlight
`;

      mockVault.exists.mockResolvedValue(true);
      mockVault.read.mockResolvedValue(existingContent);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Book',
        highlights: [
          { id: 1, text: 'Existing highlight' },
          { id: 2, text: 'New highlight' }
        ]
      };

      await fileGenerator.generateFile(exportData);

      const appendedContent = mockVault.append.mock.calls[0][1];
      expect(appendedContent).toContain('New highlight');
      expect(appendedContent).not.toContain('Existing highlight');
    });
  });

  describe('File Tracking and Renames', () => {
    it('should track file by book ID in metadata', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 456,
        title: 'Tracked Book',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.setMetadata).toHaveBeenCalledWith(
        'Readwise/Tracked Book.md',
        expect.objectContaining({
          'readwise-id': '456'
        })
      );
    });

    it('should find renamed files by metadata', async () => {
      const oldPath = 'Readwise/Old Title.md';
      const newPath = 'Readwise/New Title.md';

      mockVault.list.mockResolvedValue([newPath]);
      mockVault.getMetadata.mockResolvedValue({
        'readwise-id': '789'
      });

      const exportData: ReadwiseExport = {
        user_book_id: 789,
        title: 'New Title',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      // Should update the existing file with new title
      expect(mockVault.write).toHaveBeenCalledWith(
        newPath,
        expect.any(String)
      );
    });

    it('should update metadata on each sync', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Meta Book',
        author: 'Meta Author',
        highlights: Array(10).fill({ id: 1, text: 'test' })
      };

      await fileGenerator.generateFile(exportData);

      expect(mockVault.setMetadata).toHaveBeenCalledWith(
        'Readwise/Meta Book.md',
        expect.objectContaining({
          'readwise-title': 'Meta Book',
          'readwise-author': 'Meta Author',
          'readwise-highlights': '10'
        })
      );
    });
  });

  describe('Supplemental Highlights', () => {
    it('should include supplemental highlights when enabled', async () => {
      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Supplemental Test',
        highlights: [
          { id: 1, text: 'Regular highlight' },
          { id: 2, text: 'Supplemental', note: '.h This is supplemental' }
        ]
      };

      await fileGenerator.generateFile(exportData);

      const content = mockVault.write.mock.calls[0][1];
      expect(content).toContain('Regular highlight');
      expect(content).toContain('Supplemental');
    });

    it('should exclude supplemental highlights when disabled', async () => {
      const settings = { ...defaultSettings, includeSupplementals: false };
      fileGenerator = new FileGenerator(mockVault, settings);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'No Supplemental',
        highlights: [
          { id: 1, text: 'Regular highlight' },
          { id: 2, text: 'Supplemental', note: '.h This is supplemental' },
          { id: 3, text: 'Another supplemental', note: '.c Chapter note' }
        ]
      };

      await fileGenerator.generateFile(exportData);

      const content = mockVault.write.mock.calls[0][1];
      expect(content).toContain('Regular highlight');
      expect(content).not.toContain('Supplemental');
      expect(content).not.toContain('Another supplemental');
    });
  });

  describe('Error Handling', () => {
    it('should fallback to default template on render error', async () => {
      const invalidTemplate = '{{#invalid}}{{/wrong}}';
      const settings = { ...defaultSettings, customTemplate: invalidTemplate };
      fileGenerator = new FileGenerator(mockVault, settings);

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Fallback Test',
        highlights: []
      };

      await fileGenerator.generateFile(exportData);

      // Should still write file with default template
      expect(mockVault.write).toHaveBeenCalled();
      const content = mockVault.write.mock.calls[0][1];
      expect(content).toContain('# Fallback Test');
    });

    it('should handle write errors gracefully', async () => {
      mockVault.write.mockRejectedValue(new Error('Write failed'));

      const exportData: ReadwiseExport = {
        user_book_id: 1,
        title: 'Error Test',
        highlights: []
      };

      await expect(fileGenerator.generateFile(exportData)).rejects.toThrow('Write failed');
    });
  });
});