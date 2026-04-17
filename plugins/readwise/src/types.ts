// Readwise Plugin Types

export interface ReadwiseSettings {
  apiToken?: string;
  syncFrequency: number;
  autoSync: boolean;
  syncOnStartup: boolean;
  highlightsFolder: string;
  dateFormat: string;
  groupBy: 'book' | 'article' | 'category' | 'date';
  appendToExisting: boolean;
  includeSupplementals: boolean;
  customTemplate?: string;
  lastSync?: string;
  lastSyncCount?: number;
}

export interface ReadwiseHighlight {
  id: number;
  text: string;
  note?: string;
  location?: number;
  location_type?: string;
  highlighted_at?: string;
  updated?: string;
  url?: string;
  tags?: ReadwiseTag[];
  is_favorite?: boolean;
  is_discard?: boolean;
  color?: string;
}

export interface ReadwiseBook {
  id: number;
  title: string;
  author?: string;
  category?: string;
  source?: string;
  num_highlights?: number;
  last_highlight_at?: string;
  updated?: string;
  cover_image_url?: string;
  highlights_url?: string;
  source_url?: string;
  asin?: string;
  tags?: ReadwiseTag[];
  document_note?: string;
}

export interface ReadwiseTag {
  id: number;
  name: string;
}

export interface ReadwiseExport {
  user_book_id: number;
  title: string;
  author?: string;
  readable_title?: string;
  source?: string;
  cover_image_url?: string;
  unique_url?: string;
  book_tags?: ReadwiseTag[];
  category?: string;
  document_note?: string;
  summary?: string;
  highlights: ReadwiseHighlight[];
}

export interface SyncResult {
  success: boolean;
  processed?: number;
  failed?: number;
  skipped?: number;
  error?: string;
  errors?: string[];
  batched?: boolean;
  batchCount?: number;
  newHighlights?: number;
  updatedHighlights?: number;
  deletedHighlights?: number;
  retries?: number;
}

export interface SyncProgress {
  current?: number;
  total?: number;
  currentBook?: string;
  status: 'fetching' | 'processing' | 'writing' | 'complete' | 'error';
  message?: string;
  processed?: number;
  failed?: number;
  duration?: number;
  error?: any;
}

export interface TemplateContext {
  title: string;
  author?: string;
  category?: string;
  source?: string;
  url?: string;
  cover?: string;
  tags?: string[];
  documentNote?: string;
  highlights: Array<{
    id?: number;
    hash?: string;
    text: string;
    note?: string;
    location?: string;
    date?: string;
    tags?: string[];
    color?: string;
    favorite?: boolean;
  }>;
  syncDate: string;
  highlightCount: number;
}