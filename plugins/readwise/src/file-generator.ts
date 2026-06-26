// File Generator for Readwise highlights
import type { VaultAPI } from '@vault/plugin-api';
import type { ReadwiseSettings, ReadwiseExport, TemplateContext } from './types';
import Mustache from 'mustache';
import { marked } from 'marked';

const DEFAULT_TEMPLATE = `---
title: {{title}}
author: {{#author}}{{author}}{{/author}}
category: {{#category}}{{category}}{{/category}}
source: {{#source}}{{source}}{{/source}}
url: {{#url}}{{url}}{{/url}}
tags: {{#tags}}#{{.}} {{/tags}}
date: {{syncDate}}
highlights: {{highlightCount}}
---

# {{title}}

{{#author}}Author: {{author}}{{/author}}
{{#category}}Category: {{category}}{{/category}}
{{#url}}Source: [Link]({{url}}){{/url}}

{{#documentNote}}
## Document Note
{{documentNote}}
{{/documentNote}}

## Highlights

{{#highlights}}
### {{#location}}Location {{location}}{{/location}}{{^location}}Highlight{{/location}}
<!-- readwise-id: {{id}} -->
<!-- readwise-hash: {{hash}} -->

> {{text}}

{{#note}}
**Note:** {{note}}
{{/note}}

{{#tags}}Tags: {{#tags}}#{{.}} {{/tags}}{{/tags}}
{{#date}}Date: {{date}}{{/date}}

---

{{/highlights}}

*Synced from Readwise on {{syncDate}}*`;

export class FileGenerator {
  private vault: VaultAPI;
  private settings: ReadwiseSettings;

  constructor(vault: VaultAPI, settings: ReadwiseSettings) {
    this.vault = vault;
    this.settings = settings;
  }

  updateSettings(settings: ReadwiseSettings): void {
    this.settings = settings;
  }

  async generateFile(exportData: ReadwiseExport): Promise<void> {
    const filePath = this.getFilePath(exportData);
    const content = await this.generateContent(exportData);
    
    if (this.settings.appendToExisting && await this.vault.exists(filePath)) {
      await this.appendToFile(filePath, content, exportData);
    } else {
      await this.vault.write(filePath, content);
    }
    
    // Set metadata
    await this.vault.setMetadata(filePath, {
      'readwise-id': exportData.user_book_id.toString(),
      'readwise-title': exportData.title,
      'readwise-author': exportData.author || '',
      'readwise-synced': new Date().toISOString(),
      'readwise-highlights': exportData.highlights.length.toString()
    });
  }

  private getFilePath(exportData: ReadwiseExport): string {
    const folder = this.settings.highlightsFolder;
    let subfolder = '';
    let filename = this.sanitizeFilename(exportData.title);
    
    switch (this.settings.groupBy) {
      case 'book':
        // Default, no subfolder
        break;
      case 'article':
        subfolder = exportData.category === 'articles' ? 'Articles' : 'Books';
        break;
      case 'category':
        subfolder = exportData.category || 'Uncategorized';
        break;
      case 'date':
        const date = new Date();
        subfolder = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        break;
    }
    
    const path = subfolder 
      ? `${folder}/${subfolder}/${filename}.md`
      : `${folder}/${filename}.md`;
    
    return path;
  }

  private sanitizeFilename(name: string): string {
    // Remove invalid characters for filenames
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200); // Limit length
  }

  private async generateContent(exportData: ReadwiseExport): Promise<string> {
    const template = this.settings.customTemplate || DEFAULT_TEMPLATE;
    const context = this.createTemplateContext(exportData);
    
    try {
      return Mustache.render(template, context);
    } catch (error) {
      console.error('Template rendering failed:', error);
      // Fallback to default template
      return Mustache.render(DEFAULT_TEMPLATE, context);
    }
  }

  private createTemplateContext(exportData: ReadwiseExport): TemplateContext {
    const now = new Date();
    const dateFormat = this.settings.dateFormat;
    
    return {
      title: exportData.title,
      author: exportData.author,
      category: exportData.category,
      source: exportData.source,
      url: exportData.unique_url,
      cover: exportData.cover_image_url,
      tags: exportData.book_tags?.map(t => t.name),
      documentNote: exportData.document_note,
      highlights: exportData.highlights
        .filter(h => !h.is_discard && (this.settings.includeSupplementals || !this.isSupplemental(h)))
        .map(h => ({
          id: h.id,
          hash: this.generateHighlightHash(h),
          text: h.text,
          note: h.note,
          location: h.location?.toString(),
          date: h.highlighted_at ? this.formatDate(h.highlighted_at, dateFormat) : undefined,
          tags: h.tags?.map(t => t.name),
          color: h.color,
          favorite: h.is_favorite
        })),
      syncDate: this.formatDate(now.toISOString(), dateFormat),
      highlightCount: exportData.highlights.length
    };
  }

  private formatDate(isoDate: string, format: string): string {
    const date = new Date(isoDate);
    
    return format
      .replace('YYYY', date.getFullYear().toString())
      .replace('MM', String(date.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(date.getDate()).padStart(2, '0'))
      .replace('HH', String(date.getHours()).padStart(2, '0'))
      .replace('mm', String(date.getMinutes()).padStart(2, '0'))
      .replace('ss', String(date.getSeconds()).padStart(2, '0'));
  }

  private isSupplemental(highlight: any): boolean {
    // Readwise supplemental highlights typically have special markers
    return highlight.note?.startsWith('.h ') || 
           highlight.note?.startsWith('.c ') ||
           highlight.location_type === 'supplemental';
  }

  private async appendToFile(
    filePath: string, 
    newContent: string, 
    exportData: ReadwiseExport
  ): Promise<void> {
    const existingContent = await this.vault.read(filePath);
    
    // Extract new highlights that aren't already in the file
    const existingIds = this.extractHighlightIds(existingContent);
    const existingHashes = this.extractHighlightHashes(existingContent);
    const newHighlights = exportData.highlights.filter(h => {
      const id = h.id.toString();
      const hash = this.generateHighlightHash(h);
      return !existingIds.has(id) && !existingHashes.has(hash);
    });
    
    if (newHighlights.length === 0) {
      return; // No new highlights to add
    }
    
    // Generate content for just the new highlights
    const appendContext = this.createTemplateContext({
      ...exportData,
      highlights: newHighlights
    });
    
    const appendTemplate = `

## New Highlights ({{syncDate}})

{{#highlights}}
### {{#location}}Location {{location}}{{/location}}{{^location}}Highlight{{/location}}
<!-- readwise-id: {{id}} -->
<!-- readwise-hash: {{hash}} -->

> {{text}}

{{#note}}
**Note:** {{note}}
{{/note}}

---

{{/highlights}}`;
    
    const appendContent = Mustache.render(appendTemplate, {
      ...appendContext,
      highlights: newHighlights.map(h => ({
        ...appendContext.highlights.find(ah => ah.text === h.text),
        id: h.id,
        hash: this.generateHighlightHash(h)
      }))
    });
    
    await this.vault.append(filePath, appendContent);
  }

  private extractHighlightIds(content: string): Set<string> {
    const ids = new Set<string>();
    const regex = /<!-- readwise-id: (\d+) -->/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      ids.add(match[1]);
    }
    
    return ids;
  }

  private extractHighlightHashes(content: string): Set<string> {
    const hashes = new Set<string>();
    const regex = /<!-- readwise-hash: ([a-f0-9]+) -->/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      hashes.add(match[1]);
    }
    
    return hashes;
  }

  private generateHighlightHash(highlight: ReadwiseHighlight): string {
    const content = `${highlight.text || ''}|${highlight.note || ''}|${highlight.location || ''}`;
    // Simple hash function for browser environment
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(16, '0').substring(0, 16);
  }

  async findFileByBookId(bookId: number): Promise<string | null> {
    try {
      const files = await this.vault.list(this.settings.highlightsFolder);
      
      for (const file of files) {
        const metadata = await this.vault.getMetadata(file);
        if (metadata && metadata['readwise-id'] === bookId.toString()) {
          return file;
        }
      }
    } catch (error) {
      console.error('Failed to find file by book ID:', error);
    }
    
    return null;
  }
}