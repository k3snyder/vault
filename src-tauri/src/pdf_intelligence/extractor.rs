/// PDF text extraction using pdfium-render (primary) with pdf-extract fallback
///
/// This module handles text extraction from PDF files:
/// - Primary: pdfium-render for accurate per-page text extraction
/// - Fallback: pdf-extract for text when pdfium is unavailable
use std::path::Path;
use std::sync::OnceLock;
use thiserror::Error;

use pdfium_render::prelude::*;

/// Cached path to pdfium library directory (found once, reused)
static PDFIUM_LIB_DIR: OnceLock<Option<String>> = OnceLock::new();

/// Find the pdfium library directory, caching the result
/// Note: pdfium_platform_library_name_at_path expects a DIRECTORY, not full file path
fn find_pdfium_library_dir() -> Option<&'static str> {
    PDFIUM_LIB_DIR
        .get_or_init(|| {
            // Try to find pdfium from various directory locations
            // These are DIRECTORIES that should contain libpdfium.dylib
            let lib_dirs = [
                // Absolute path for development (most reliable)
                concat!(env!("CARGO_MANIFEST_DIR"), "/libs/pdfium/lib"),
                // Project-local library (from src-tauri directory)
                "./libs/pdfium/lib",
                // Relative to executable in target/debug
                "../libs/pdfium/lib",
                "../../libs/pdfium/lib",
                // Current directory
                ".",
                // System locations
                "/usr/local/lib",
                "/opt/homebrew/lib",
            ];

            for dir in lib_dirs {
                let lib_path = format!("{}/libpdfium.dylib", dir);
                if Path::new(&lib_path).exists() {
                    println!("Found pdfium library in: {}", dir);
                    return Some(dir.to_string());
                }
            }

            eprintln!("Pdfium library not found in any standard location");
            eprintln!("PDF text extraction will use fallback mode");
            None
        })
        .as_ref()
        .map(|s| s.as_str())
}

/// Create a new Pdfium instance (binds to library each call)
fn create_pdfium() -> Option<Pdfium> {
    // Try cached directory first
    if let Some(dir) = find_pdfium_library_dir() {
        match Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(dir)) {
            Ok(bindings) => {
                println!("Pdfium library bound successfully");
                return Some(Pdfium::new(bindings));
            }
            Err(e) => {
                eprintln!("Failed to bind to pdfium in {}: {:?}", dir, e);
            }
        }
    }

    // Try system library as fallback
    match Pdfium::bind_to_system_library() {
        Ok(bindings) => Some(Pdfium::new(bindings)),
        Err(_) => None,
    }
}

/// Errors that can occur during PDF extraction
#[derive(Debug, Error)]
pub enum ExtractionError {
    #[error("PDF file not found: '{0}'. Please check that the file exists and you have permission to read it.")]
    FileNotFound(String),

    #[error("Unable to read PDF file: {0}. The file may be corrupted or inaccessible.")]
    ReadError(String),

    #[error("Failed to extract content from PDF: {0}")]
    ExtractionError(String),

    #[error(
        "This PDF is password-protected. Please remove the password protection and try again."
    )]
    PasswordProtected,

    #[error("The PDF appears to be corrupted and cannot be processed. Try opening it in a PDF viewer to verify its integrity.")]
    CorruptedFile,
}

/// Extract text from a PDF file, returning text content per page
///
/// Uses pdfium-render for accurate per-page text extraction.
/// Falls back to pdf-extract if pdfium is unavailable.
///
/// # Arguments
/// * `path` - Path to the PDF file
///
/// # Returns
/// * `Ok(Vec<String>)` - Vector of strings, one per page
/// * `Err(ExtractionError)` - Error if extraction fails
pub fn extract_text_from_pdf(path: &str) -> Result<Vec<String>, ExtractionError> {
    // Validate file exists
    let pdf_path = Path::new(path);
    if !pdf_path.exists() {
        return Err(ExtractionError::FileNotFound(format!(
            "PDF file not found: {path}"
        )));
    }

    // Try pdfium first
    if let Some(pdfium) = create_pdfium() {
        match extract_text_with_pdfium(&pdfium, path) {
            Ok(pages) => return Ok(pages),
            Err(e) => {
                eprintln!(
                    "Pdfium extraction failed, falling back to pdf-extract: {:?}",
                    e
                );
            }
        }
    }

    // Fallback to pdf-extract
    extract_text_with_pdf_extract(path)
}

/// Extract text using pdfium-render (per-page accurate extraction)
fn extract_text_with_pdfium(pdfium: &Pdfium, path: &str) -> Result<Vec<String>, ExtractionError> {
    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| {
        let err_msg = format!("{:?}", e);
        if err_msg.contains("password") || err_msg.contains("Password") {
            ExtractionError::PasswordProtected
        } else {
            ExtractionError::ReadError(format!("Failed to load PDF: {}", err_msg))
        }
    })?;

    let page_count = document.pages().len();
    let mut pages = Vec::with_capacity(page_count as usize);

    for page in document.pages().iter() {
        let text = page.text().map_err(|e| {
            ExtractionError::ExtractionError(format!("Failed to get page text: {:?}", e))
        })?;

        let page_text = text.all();
        pages.push(page_text);
    }

    println!("Pdfium extracted {} pages with text", pages.len());
    Ok(pages)
}

/// Fallback text extraction using pdf-extract
fn extract_text_with_pdf_extract(path: &str) -> Result<Vec<String>, ExtractionError> {
    // Extract text using pdf-extract
    let text = pdf_extract::extract_text(path).map_err(|e| {
        let err_msg = e.to_string();
        if err_msg.contains("password") || err_msg.contains("encrypted") {
            ExtractionError::PasswordProtected
        } else if err_msg.contains("invalid")
            || err_msg.contains("malformed")
            || err_msg.contains("corrupt")
        {
            ExtractionError::CorruptedFile
        } else {
            ExtractionError::ExtractionError(format!("PDF extraction failed: {err_msg}"))
        }
    })?;

    // Split text by page markers (form feed characters)
    let pages: Vec<String> = text
        .split('\x0C')
        .map(|page_text| page_text.trim().to_string())
        .filter(|page_text| !page_text.is_empty())
        .collect();

    // If no page markers found, return whole text as single page
    if pages.is_empty() && !text.trim().is_empty() {
        Ok(vec![text.trim().to_string()])
    } else {
        Ok(pages)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_extract_text_from_missing_file() {
        let result = extract_text_from_pdf("/nonexistent/path/to/file.pdf");
        assert!(result.is_err());
        match result {
            Err(ExtractionError::FileNotFound(_)) => {}
            _ => panic!("Expected FileNotFound error"),
        }
    }

    #[test]
    fn test_extract_text_from_invalid_file() {
        let mut temp_file = NamedTempFile::new().unwrap();
        temp_file.write_all(b"This is not a valid PDF").unwrap();
        temp_file.flush().unwrap();

        let result = extract_text_from_pdf(temp_file.path().to_str().unwrap());
        assert!(result.is_err());
    }
}
