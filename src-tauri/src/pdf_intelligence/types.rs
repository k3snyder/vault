/// PDF Intelligence type definitions
///
/// Defines all types for PDF extraction, vision processing, and summarization
use serde::{Deserialize, Serialize};
use specta::Type;

// ============================================================================
// Configuration Types
// ============================================================================

/// Configuration for PDF extraction
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionConfig {
    pub mode: ExtractionMode,
    pub image_dpi: u32,
    pub vision_mode: VisionMode,
    pub summarization: SummarizationLevel,
}

/// Extraction mode determining what content to extract
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ExtractionMode {
    /// Extract text, tables, and images
    Full,
    /// Extract text and images, skip tables
    TextAndImages,
    /// Extract only text (fastest)
    TextOnly,
}

/// Vision processing provider
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum VisionMode {
    /// Skip vision processing
    None,
    /// DeepSeek OCR
    DeepseekOcr,
    /// Gemini Vision
    GeminiVision,
    /// OpenAI Vision
    OpenaiVision,
    /// Ollama Vision (local)
    OllamaVision,
}

/// Summarization level
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SummarizationLevel {
    /// Full notes and topics with quality validation
    Full,
    /// Extract only topics, faster
    TopicsOnly,
    /// Skip summarization
    Skip,
}

// ============================================================================
// Extraction Result Types
// ============================================================================

/// Complete PDF extraction result
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PdfExtractionResult {
    pub document_id: String,
    pub filename: String,
    pub total_pages: u32,
    pub pages: Vec<ExtractedPage>,
    pub metadata: PdfMetadata,
}

/// Extracted content from a single page
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedPage {
    pub page_number: u32,
    pub text: String,
    pub tables: Vec<ExtractedTable>,
    pub images: Vec<ExtractedImage>,
}

/// Extracted table data
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedTable {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub bbox: Option<BoundingBox>,
}

/// Extracted image data
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedImage {
    pub image_index: u32,
    pub base64_data: String,
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
}

/// Bounding box coordinates
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoundingBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// PDF metadata
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub created: Option<String>,
}

// ============================================================================
// Intelligence Result Types (after MCP enrichment)
// ============================================================================

/// Complete intelligence result including extraction and enrichments
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceResult {
    pub version: String,
    pub generated_at: String,
    pub source_pdf: String,
    pub config: ExtractionConfig,
    pub extraction: PdfExtractionResult,
    pub enrichments: Vec<PageEnrichment>,
    pub processing_stats: ProcessingStats,
}

/// AI-generated enrichments for a page
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PageEnrichment {
    pub page_number: u32,
    pub image_text: Option<String>,
    pub visual_classification: Option<String>,
    pub summary_notes: Option<Vec<String>>,
    pub summary_topics: Option<Vec<String>>,
    pub relevancy_score: Option<f32>,
}

/// Processing statistics
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingStats {
    pub extraction_time_ms: u64,
    pub vision_time_ms: Option<u64>,
    pub summarization_time_ms: Option<u64>,
    pub pages_with_vision: u32,
}

// ============================================================================
// V2 Schema Types (Summarizer-compatible flattened structure)
// ============================================================================

/// V2 Intelligence result with flattened chunk-based structure
/// Compatible with summarizer-app enriched.json schema
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceResultV2 {
    pub document: DocumentMetadata,
    pub pages: Vec<EnrichedChunk>,
}

/// Document-level metadata
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    pub document_id: String,
    pub filename: String,
    pub total_pages: u32,
    pub metadata: std::collections::HashMap<String, String>,
}

/// Enriched chunk containing all data for a single page
/// Each chunk represents one page with text, screenshot, and enrichments combined
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedChunk {
    /// Unique chunk identifier: "chunk_1", "chunk_2", etc.
    pub chunk_id: String,
    /// Document filename for reference
    pub doc_title: String,
    /// Extracted text content from this page
    pub text: String,
    /// Detected tables on this page
    pub tables: Vec<TableV2>,
    /// Full-page screenshot as base64-encoded PNG
    /// This is a visual render of the entire page, not individual embedded images
    pub image_base64: String,
    /// Whether vision classifier was applied (for future use)
    pub image_classifier: bool,
    /// Vision-extracted text from page screenshot (OCR results)
    pub image_text: String,
    /// AI-generated summary bullet points
    pub summary_notes: Vec<String>,
    /// Extracted topic tags
    pub summary_topics: Vec<String>,
    /// Relevancy/quality score 0-100
    pub summary_relevancy: u8,
}

/// V2 Table structure with cross-page continuity support
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableV2 {
    pub columns: Vec<String>,
    pub data: Vec<Vec<String>>,
    /// Indicates if table continues beyond visible page area
    pub extends_to_bottom: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extraction_mode_serialization() {
        let full = ExtractionMode::Full;
        let json = serde_json::to_string(&full).unwrap();
        assert_eq!(json, "\"full\"");

        let text_and_images = ExtractionMode::TextAndImages;
        let json = serde_json::to_string(&text_and_images).unwrap();
        assert_eq!(json, "\"textAndImages\"");

        let text_only = ExtractionMode::TextOnly;
        let json = serde_json::to_string(&text_only).unwrap();
        assert_eq!(json, "\"textOnly\"");
    }

    #[test]
    fn test_vision_mode_serialization() {
        let none = VisionMode::None;
        let json = serde_json::to_string(&none).unwrap();
        assert_eq!(json, "\"none\"");

        let deepseek = VisionMode::DeepseekOcr;
        let json = serde_json::to_string(&deepseek).unwrap();
        assert_eq!(json, "\"deepseekOcr\"");

        let gemini = VisionMode::GeminiVision;
        let json = serde_json::to_string(&gemini).unwrap();
        assert_eq!(json, "\"geminiVision\"");

        let openai = VisionMode::OpenaiVision;
        let json = serde_json::to_string(&openai).unwrap();
        assert_eq!(json, "\"openaiVision\"");

        let ollama = VisionMode::OllamaVision;
        let json = serde_json::to_string(&ollama).unwrap();
        assert_eq!(json, "\"ollamaVision\"");
    }

    #[test]
    fn test_summarization_level_serialization() {
        let full = SummarizationLevel::Full;
        let json = serde_json::to_string(&full).unwrap();
        assert_eq!(json, "\"full\"");

        let topics = SummarizationLevel::TopicsOnly;
        let json = serde_json::to_string(&topics).unwrap();
        assert_eq!(json, "\"topicsOnly\"");

        let skip = SummarizationLevel::Skip;
        let json = serde_json::to_string(&skip).unwrap();
        assert_eq!(json, "\"skip\"");
    }

    #[test]
    fn test_extraction_config_serialization() {
        let config = ExtractionConfig {
            mode: ExtractionMode::Full,
            image_dpi: 144,
            vision_mode: VisionMode::GeminiVision,
            summarization: SummarizationLevel::Full,
        };

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"mode\""));
        assert!(json.contains("\"full\""));
        assert!(json.contains("\"imageDpi\""));
        assert!(json.contains("144"));
        assert!(json.contains("\"visionMode\""));
        assert!(json.contains("\"geminiVision\""));
        assert!(json.contains("\"summarization\""));
    }

    #[test]
    fn test_extraction_config_deserialization() {
        let json = r#"{
            "mode": "textOnly",
            "imageDpi": 72,
            "visionMode": "none",
            "summarization": "skip"
        }"#;

        let config: ExtractionConfig = serde_json::from_str(json).unwrap();
        assert!(matches!(config.mode, ExtractionMode::TextOnly));
        assert_eq!(config.image_dpi, 72);
        assert!(matches!(config.vision_mode, VisionMode::None));
        assert!(matches!(config.summarization, SummarizationLevel::Skip));
    }

    #[test]
    fn test_pdf_extraction_result_serialization() {
        let result = PdfExtractionResult {
            document_id: "doc_123".to_string(),
            filename: "test.pdf".to_string(),
            total_pages: 10,
            pages: vec![],
            metadata: PdfMetadata {
                title: Some("Test Document".to_string()),
                author: Some("Test Author".to_string()),
                created: Some("2024-01-01".to_string()),
            },
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"documentId\""));
        assert!(json.contains("\"doc_123\""));
        assert!(json.contains("\"totalPages\""));
        assert!(json.contains("10"));
    }

    #[test]
    fn test_extracted_page_serialization() {
        let page = ExtractedPage {
            page_number: 1,
            text: "Sample text".to_string(),
            tables: vec![],
            images: vec![],
        };

        let json = serde_json::to_string(&page).unwrap();
        assert!(json.contains("\"pageNumber\""));
        assert!(json.contains("\"text\""));
        assert!(json.contains("Sample text"));
    }

    #[test]
    fn test_extracted_table_serialization() {
        let table = ExtractedTable {
            columns: vec!["Col1".to_string(), "Col2".to_string()],
            rows: vec![
                vec!["A".to_string(), "B".to_string()],
                vec!["C".to_string(), "D".to_string()],
            ],
            bbox: Some(BoundingBox {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 50.0,
            }),
        };

        let json = serde_json::to_string(&table).unwrap();
        assert!(json.contains("\"columns\""));
        assert!(json.contains("Col1"));
        assert!(json.contains("\"rows\""));
        assert!(json.contains("\"bbox\""));
    }

    #[test]
    fn test_extracted_image_serialization() {
        let image = ExtractedImage {
            image_index: 0,
            base64_data: "data:image/png;base64,abc123".to_string(),
            width: 800,
            height: 600,
            mime_type: "image/png".to_string(),
        };

        let json = serde_json::to_string(&image).unwrap();
        assert!(json.contains("\"imageIndex\""));
        assert!(json.contains("\"base64Data\""));
        assert!(json.contains("\"mimeType\""));
    }

    #[test]
    fn test_intelligence_result_serialization() {
        let result = IntelligenceResult {
            version: "1.0".to_string(),
            generated_at: "2024-01-01T00:00:00Z".to_string(),
            source_pdf: "test.pdf".to_string(),
            config: ExtractionConfig {
                mode: ExtractionMode::Full,
                image_dpi: 144,
                vision_mode: VisionMode::None,
                summarization: SummarizationLevel::Skip,
            },
            extraction: PdfExtractionResult {
                document_id: "doc_123".to_string(),
                filename: "test.pdf".to_string(),
                total_pages: 1,
                pages: vec![],
                metadata: PdfMetadata {
                    title: None,
                    author: None,
                    created: None,
                },
            },
            enrichments: vec![],
            processing_stats: ProcessingStats {
                extraction_time_ms: 1000,
                vision_time_ms: None,
                summarization_time_ms: None,
                pages_with_vision: 0,
            },
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"version\""));
        assert!(json.contains("\"generatedAt\""));
        assert!(json.contains("\"sourcePdf\""));
        assert!(json.contains("\"processingStats\""));
    }

    #[test]
    fn test_page_enrichment_serialization() {
        let enrichment = PageEnrichment {
            page_number: 1,
            image_text: Some("Extracted text from image".to_string()),
            visual_classification: Some("diagram".to_string()),
            summary_notes: Some(vec!["Note 1".to_string(), "Note 2".to_string()]),
            summary_topics: Some(vec!["topic1".to_string(), "topic2".to_string()]),
            relevancy_score: Some(92.5),
        };

        let json = serde_json::to_string(&enrichment).unwrap();
        assert!(json.contains("\"pageNumber\""));
        assert!(json.contains("\"imageText\""));
        assert!(json.contains("\"visualClassification\""));
        assert!(json.contains("\"summaryNotes\""));
        assert!(json.contains("\"summaryTopics\""));
        assert!(json.contains("\"relevancyScore\""));
    }

    #[test]
    fn test_processing_stats_serialization() {
        let stats = ProcessingStats {
            extraction_time_ms: 1500,
            vision_time_ms: Some(3000),
            summarization_time_ms: Some(5000),
            pages_with_vision: 5,
        };

        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("\"extractionTimeMs\""));
        assert!(json.contains("\"visionTimeMs\""));
        assert!(json.contains("\"summarizationTimeMs\""));
        assert!(json.contains("\"pagesWithVision\""));
    }

    #[test]
    fn test_clone_implementations() {
        let config = ExtractionConfig {
            mode: ExtractionMode::Full,
            image_dpi: 144,
            vision_mode: VisionMode::None,
            summarization: SummarizationLevel::Skip,
        };

        let cloned = config.clone();
        assert_eq!(cloned.image_dpi, config.image_dpi);
    }
}
