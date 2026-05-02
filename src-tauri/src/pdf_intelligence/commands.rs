/// Tauri commands for PDF intelligence
///
/// This module provides IPC commands for PDF text extraction, storage, and export.
/// Text extraction only; advanced features (tables, images, vision) intentionally omitted from text extraction.
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use crate::pdf_intelligence::{
    extract_text_from_pdf, DocumentMetadata, EnrichedChunk, ExtractionConfig, IntelligenceResult,
    IntelligenceResultV2, PdfExtractionResult, PdfMetadata,
};

/// Extract intelligence from a PDF file (V1 schema)
///
/// Extracts text content from all pages. Tables and images are empty (not extracted here).
///
/// # Arguments
/// * `pdf_path` - Absolute path to the PDF file
/// * `config` - Extraction configuration (mode fields ignored, always text-only)
///
/// # Returns
/// * `Ok(PdfExtractionResult)` - Extracted text content
/// * `Err(String)` - Error message if extraction fails
#[tauri::command]
pub async fn extract_pdf_intelligence(
    pdf_path: String,
    _config: ExtractionConfig,
) -> Result<PdfExtractionResult, String> {
    let start_time = Instant::now();

    // Validate file exists
    let path = Path::new(&pdf_path);
    if !path.exists() {
        return Err(format!("PDF file not found: {pdf_path}"));
    }

    // Extract filename
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.pdf")
        .to_string();

    // Generate document ID
    let document_id = format!("doc_{}", filename.replace(".pdf", ""));

    // Extract text from all pages
    let page_texts =
        extract_text_from_pdf(&pdf_path).map_err(|e| format!("Text extraction failed: {e}"))?;

    let total_pages = page_texts.len() as u32;

    // Build pages with text only (tables/images empty for future native enrichment)
    let pages: Vec<crate::pdf_intelligence::ExtractedPage> = page_texts
        .iter()
        .enumerate()
        .map(
            |(page_idx, page_text)| crate::pdf_intelligence::ExtractedPage {
                page_number: (page_idx + 1) as u32,
                text: page_text.clone(),
                tables: Vec::new(),
                images: Vec::new(),
            },
        )
        .collect();

    // Basic metadata
    let metadata = PdfMetadata {
        title: Some(filename.clone()),
        author: None,
        created: None,
    };

    let extraction_time = start_time.elapsed().as_millis() as u64;

    println!(
        "PDF text extraction completed in {}ms: {} pages",
        extraction_time,
        pages.len()
    );

    Ok(PdfExtractionResult {
        document_id,
        filename,
        total_pages,
        pages,
        metadata,
    })
}

/// Extract PDF intelligence with V2 flattened schema (summarizer-compatible)
///
/// Returns a flattened structure where each page is an enriched chunk containing:
/// - chunk_id: "chunk_1", "chunk_2", etc.
/// - text: Extracted text content
/// - Empty enrichment fields (reserved for future native enrichment)
///
/// # Arguments
/// * `pdf_path` - Absolute path to the PDF file
/// * `config` - Extraction configuration (mode fields ignored, always text-only)
///
/// # Returns
/// * `Ok(IntelligenceResultV2)` - Flattened chunk-based result
/// * `Err(String)` - Error message if extraction fails
#[tauri::command]
pub async fn extract_pdf_intelligence_v2(
    pdf_path: String,
    _config: ExtractionConfig,
) -> Result<IntelligenceResultV2, String> {
    let start_time = Instant::now();

    // Validate file exists
    let path = Path::new(&pdf_path);
    if !path.exists() {
        return Err(format!("PDF file not found: {pdf_path}"));
    }

    // Extract filename
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.pdf")
        .to_string();

    // Generate document ID
    let document_id = format!("doc_{}", filename);

    // Extract text from all pages
    let page_texts =
        extract_text_from_pdf(&pdf_path).map_err(|e| format!("Text extraction failed: {e}"))?;

    let total_pages = page_texts.len() as u32;

    // Build enriched chunks with text only (enrichments empty for future native enrichment)
    let chunks: Vec<EnrichedChunk> = page_texts
        .iter()
        .enumerate()
        .map(|(page_idx, page_text)| {
            let page_number = (page_idx + 1) as u32;
            EnrichedChunk {
                chunk_id: format!("chunk_{}", page_number),
                doc_title: filename.clone(),
                text: page_text.clone(),
                tables: Vec::new(),
                image_base64: String::new(),
                image_classifier: false,
                image_text: String::new(),
                summary_notes: Vec::new(),
                summary_topics: Vec::new(),
                summary_relevancy: 0,
            }
        })
        .collect();

    let extraction_time = start_time.elapsed().as_millis() as u64;

    println!(
        "PDF text extraction V2 completed in {}ms: {} chunks",
        extraction_time,
        chunks.len()
    );

    // Build document metadata
    let mut metadata = HashMap::new();
    metadata.insert(
        "extraction_time_ms".to_string(),
        extraction_time.to_string(),
    );

    Ok(IntelligenceResultV2 {
        document: DocumentMetadata {
            document_id,
            filename,
            total_pages,
            metadata,
        },
        pages: chunks,
    })
}

/// Save intelligence result to .vault.json companion file
///
/// Creates a .vault.json file alongside the PDF with pretty-printed JSON
///
/// # Arguments
/// * `pdf_path` - Path to the PDF file
/// * `result` - Complete intelligence result to save
///
/// # Returns
/// * `Ok(String)` - Path to the created .vault.json file
/// * `Err(String)` - Error message if save fails
#[tauri::command]
pub async fn save_intelligence_result(
    pdf_path: String,
    result: IntelligenceResult,
) -> Result<String, String> {
    // Generate .vault.json path
    let vault_path = if pdf_path.ends_with(".pdf") {
        format!("{}.vault.json", &pdf_path[..pdf_path.len() - 4])
    } else {
        format!("{}.vault.json", pdf_path)
    };

    // Serialize to pretty JSON
    let json = serde_json::to_string_pretty(&result)
        .map_err(|e| format!("JSON serialization failed: {e}"))?;

    // Write to file
    std::fs::write(&vault_path, json)
        .map_err(|e| format!("Failed to write .vault.json file: {e}"))?;

    println!("Intelligence result saved to: {vault_path}");

    Ok(vault_path)
}

/// Save V2 intelligence result to .vault.json companion file
///
/// Uses the flattened summarizer-compatible schema
#[tauri::command]
pub async fn save_intelligence_result_v2(
    pdf_path: String,
    result: IntelligenceResultV2,
) -> Result<String, String> {
    // Generate .vault.json path
    let vault_path = if pdf_path.ends_with(".pdf") {
        format!("{}.vault.json", &pdf_path[..pdf_path.len() - 4])
    } else {
        format!("{}.vault.json", pdf_path)
    };

    // Serialize to pretty JSON
    let json = serde_json::to_string_pretty(&result)
        .map_err(|e| format!("JSON serialization failed: {e}"))?;

    // Write to file
    std::fs::write(&vault_path, json)
        .map_err(|e| format!("Failed to write .vault.json file: {e}"))?;

    println!("Intelligence result V2 saved to: {vault_path}");

    Ok(vault_path)
}

/// Load intelligence result from .vault.json companion file
///
/// # Arguments
/// * `pdf_path` - Path to the PDF file
///
/// # Returns
/// * `Ok(Some(IntelligenceResult))` - Loaded intelligence result
/// * `Ok(None)` - No .vault.json file exists
/// * `Err(String)` - Error message if load fails
#[tauri::command]
pub async fn load_intelligence_result(
    pdf_path: String,
) -> Result<Option<IntelligenceResult>, String> {
    // Generate .vault.json path
    let vault_path = if pdf_path.ends_with(".pdf") {
        format!("{}.vault.json", &pdf_path[..pdf_path.len() - 4])
    } else {
        format!("{}.vault.json", pdf_path)
    };

    // Check if file exists
    let path = Path::new(&vault_path);
    if !path.exists() {
        return Ok(None);
    }

    // Read file
    let json = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read .vault.json file: {e}"))?;

    // Parse JSON
    let result: IntelligenceResult =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse .vault.json: {e}"))?;

    println!("Intelligence result loaded from: {vault_path}");

    Ok(Some(result))
}

/// Export intelligence result to Markdown file
///
/// Creates a .md file alongside the PDF with formatted content
///
/// # Arguments
/// * `pdf_path` - Path to the PDF file
/// * `result` - Intelligence result to export
///
/// # Returns
/// * `Ok(String)` - Path to the created Markdown file
/// * `Err(String)` - Error message if export fails
#[tauri::command]
pub async fn export_intelligence_markdown(
    pdf_path: String,
    result: IntelligenceResult,
) -> Result<String, String> {
    // Generate .md path
    let md_path = if pdf_path.ends_with(".pdf") {
        format!("{}-intelligence.md", &pdf_path[..pdf_path.len() - 4])
    } else {
        format!("{}-intelligence.md", pdf_path)
    };

    // Build markdown content
    let mut markdown = String::new();

    // Header
    markdown.push_str(&format!("# Intelligence Report: {}\n\n", result.source_pdf));
    markdown.push_str(&format!("Generated: {}\n\n", result.generated_at));

    // Document metadata
    markdown.push_str("## Document Information\n\n");
    markdown.push_str(&format!(
        "- **Total Pages:** {}\n",
        result.extraction.total_pages
    ));
    if let Some(title) = &result.extraction.metadata.title {
        markdown.push_str(&format!("- **Title:** {title}\n"));
    }
    if let Some(author) = &result.extraction.metadata.author {
        markdown.push_str(&format!("- **Author:** {author}\n"));
    }
    if let Some(created) = &result.extraction.metadata.created {
        markdown.push_str(&format!("- **Created:** {created}\n"));
    }
    markdown.push_str("\n");

    // Processing statistics
    markdown.push_str("## Processing Statistics\n\n");
    markdown.push_str(&format!(
        "- **Extraction Time:** {}ms\n\n",
        result.processing_stats.extraction_time_ms
    ));

    // Page-by-page content
    markdown.push_str("## Content\n\n");

    for page in &result.extraction.pages {
        markdown.push_str(&format!("### Page {}\n\n", page.page_number));

        // Find enrichment for this page
        let enrichment = result
            .enrichments
            .iter()
            .find(|e| e.page_number == page.page_number);

        // Summary notes
        if let Some(enrichment) = enrichment {
            if let Some(notes) = &enrichment.summary_notes {
                markdown.push_str("#### Summary\n\n");
                for note in notes {
                    markdown.push_str(&format!("- {note}\n"));
                }
                markdown.push_str("\n");
            }

            // Topics
            if let Some(topics) = &enrichment.summary_topics {
                markdown.push_str("**Topics:** ");
                markdown.push_str(&topics.join(", "));
                markdown.push_str("\n\n");
            }
        }

        // Text content
        if !page.text.is_empty() {
            markdown.push_str("#### Text\n\n");
            markdown.push_str(&page.text);
            markdown.push_str("\n\n");
        }

        markdown.push_str("---\n\n");
    }

    // Write to file
    std::fs::write(&md_path, markdown)
        .map_err(|e| format!("Failed to write Markdown file: {e}"))?;

    println!("Intelligence exported to Markdown: {md_path}");

    Ok(md_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf_intelligence::types::{
        ExtractedPage, ExtractionMode, ProcessingStats, SummarizationLevel, VisionMode,
    };
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_extract_pdf_intelligence_missing_file() {
        let config = ExtractionConfig {
            mode: ExtractionMode::TextOnly,
            image_dpi: 144,
            vision_mode: VisionMode::None,
            summarization: SummarizationLevel::Skip,
        };

        let result = extract_pdf_intelligence("/nonexistent/file.pdf".to_string(), config).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn test_save_and_load_intelligence_result() {
        // Create a test result
        let result = IntelligenceResult {
            version: "1.0".to_string(),
            generated_at: "2024-01-01T00:00:00Z".to_string(),
            source_pdf: "test.pdf".to_string(),
            config: ExtractionConfig {
                mode: ExtractionMode::TextOnly,
                image_dpi: 144,
                vision_mode: VisionMode::None,
                summarization: SummarizationLevel::Skip,
            },
            extraction: PdfExtractionResult {
                document_id: "doc_test".to_string(),
                filename: "test.pdf".to_string(),
                total_pages: 1,
                pages: vec![ExtractedPage {
                    page_number: 1,
                    text: "Test content".to_string(),
                    tables: vec![],
                    images: vec![],
                }],
                metadata: PdfMetadata {
                    title: Some("Test".to_string()),
                    author: None,
                    created: None,
                },
            },
            enrichments: vec![],
            processing_stats: ProcessingStats {
                extraction_time_ms: 100,
                vision_time_ms: None,
                summarization_time_ms: None,
                pages_with_vision: 0,
            },
        };

        // Create a temporary file for testing
        let temp_file = NamedTempFile::new().unwrap();
        let test_path = temp_file.path().to_str().unwrap().replace(".tmp", ".pdf");

        // Save the result
        let save_result = save_intelligence_result(test_path.clone(), result.clone()).await;
        assert!(save_result.is_ok());

        let vault_path = save_result.unwrap();
        assert!(vault_path.ends_with(".vault.json"));

        // Load the result
        let load_result = load_intelligence_result(test_path.clone()).await;
        assert!(load_result.is_ok());

        let loaded = load_result.unwrap();
        assert!(loaded.is_some());

        let loaded_result = loaded.unwrap();
        assert_eq!(loaded_result.version, "1.0");
        assert_eq!(loaded_result.extraction.total_pages, 1);

        // Cleanup
        let _ = std::fs::remove_file(&vault_path);
    }

    #[tokio::test]
    async fn test_load_nonexistent_intelligence_result() {
        let result = load_intelligence_result("/nonexistent/file.pdf".to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }
}
