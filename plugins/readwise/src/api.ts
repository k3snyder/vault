// Readwise API Client
import type { NetworkAPI } from '@vault/plugin-api';
import type { ReadwiseExport, ReadwiseBook, ReadwiseHighlight } from './types';

const READWISE_API_BASE = 'https://readwise.io/api/v2';
const READWISE_EXPORT_API = 'https://readwise.io/api/v2/export';

export class ReadwiseAPI {
  private network: NetworkAPI;
  private token?: string;

  constructor(network: NetworkAPI, token?: string) {
    this.network = network;
    this.token = token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error('No API token configured');
    }
    
    return {
      'Authorization': `Token ${this.token}`,
      'Content-Type': 'application/json'
    };
  }

  async fetchExports(updatedAfter?: string): Promise<ReadwiseExport[]> {
    const exports: ReadwiseExport[] = [];
    let nextPageCursor: string | null = null;
    
    do {
      const params = new URLSearchParams();
      if (updatedAfter) {
        params.append('updatedAfter', updatedAfter);
      }
      if (nextPageCursor) {
        params.append('pageCursor', nextPageCursor);
      }
      
      const url = `${READWISE_EXPORT_API}?${params.toString()}`;
      const response = await this.network.fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });
      
      if (!response.ok) {
        const error: any = new Error(`API request failed: ${response.status}`);
        error.status = response.status;
        error.headers = response.headers;
        throw error;
      }
      
      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error('Invalid JSON response from API');
      }
      
      if (data.results && Array.isArray(data.results)) {
        exports.push(...data.results);
      }
      
      nextPageCursor = data.nextPageCursor || null;
      
    } while (nextPageCursor);
    
    return exports;
  }

  async fetchBooks(updatedAfter?: string): Promise<ReadwiseBook[]> {
    const books: ReadwiseBook[] = [];
    let nextUrl: string | null = `${READWISE_API_BASE}/books`;
    
    if (updatedAfter) {
      nextUrl += `?updated__gt=${updatedAfter}`;
    }
    
    while (nextUrl) {
      const response = await this.network.fetch(nextUrl, {
        method: 'GET',
        headers: this.getHeaders()
      });
      
      if (!response.ok) {
        const error: any = new Error(`API request failed: ${response.status}`);
        error.status = response.status;
        error.headers = response.headers;
        throw error;
      }
      
      const data = await response.json();
      
      if (data.results && Array.isArray(data.results)) {
        books.push(...data.results);
      }
      
      nextUrl = data.next || null;
    }
    
    return books;
  }

  async fetchHighlights(
    bookId?: number,
    updatedAfter?: string
  ): Promise<ReadwiseHighlight[]> {
    const highlights: ReadwiseHighlight[] = [];
    let nextUrl: string | null = `${READWISE_API_BASE}/highlights`;
    
    const params = new URLSearchParams();
    if (bookId) {
      params.append('book_id', bookId.toString());
    }
    if (updatedAfter) {
      params.append('updated__gt', updatedAfter);
    }
    
    if (params.toString()) {
      nextUrl += `?${params.toString()}`;
    }
    
    while (nextUrl) {
      const response = await this.network.fetch(nextUrl, {
        method: 'GET',
        headers: this.getHeaders()
      });
      
      if (!response.ok) {
        const error: any = new Error(`API request failed: ${response.status}`);
        error.status = response.status;
        error.headers = response.headers;
        throw error;
      }
      
      const data = await response.json();
      
      if (data.results && Array.isArray(data.results)) {
        highlights.push(...data.results);
      }
      
      nextUrl = data.next || null;
    }
    
    return highlights;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.network.fetch(`${READWISE_API_BASE}/auth`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      
      return response.ok && response.status === 204;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }
}