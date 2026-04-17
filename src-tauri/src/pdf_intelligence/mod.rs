/// PDF Intelligence Module - Text extraction from PDF documents
///
/// This module handles PDF text extraction:
/// - Text extraction via pdfium-render (primary) with pdf-extract fallback
/// - Storage of results in .vault.json companion files
///
/// Advanced features (tables, images, vision, summarization) are handled by MCP servers.
pub mod commands;
pub mod extractor;
pub mod types;

// Re-export key types for convenience
pub use types::{
    ExtractedPage, ExtractionConfig, IntelligenceResult, PdfExtractionResult, PdfMetadata,
};

// Re-export V2 types (summarizer-compatible schema)
pub use types::{DocumentMetadata, EnrichedChunk, IntelligenceResultV2};

// Re-export extractor functionality
pub use extractor::extract_text_from_pdf;
