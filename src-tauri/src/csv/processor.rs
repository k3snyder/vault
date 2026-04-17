//! CSV processing logic
//!
//! Handles CSV parsing, type inference, and data transformation.

use std::collections::HashSet;
use std::path::Path;

use regex::Regex;
use sha2::{Digest, Sha256};

use std::collections::HashMap;

use crate::csv::types::{
    Cardinality, ColumnAiContext, ColumnMetadata, ColumnSchema, CsvAiContext, CsvData, CsvError,
    CsvRow, CsvSchema, DataType, DatasetMetadata, FormatHint, NumericStats, Relationship,
    RelationshipAiContext, SemanticRole,
};

// ============================================================================
// Constants for Type Inference
// ============================================================================

/// Maximum number of values to sample for type inference
const TYPE_INFERENCE_SAMPLE_SIZE: usize = 100;

/// Maximum number of unique values for enum detection
const ENUM_MAX_CARDINALITY: usize = 20;

/// Minimum percentage of values that must match a pattern for type detection
const TYPE_MATCH_THRESHOLD: f64 = 0.9;

/// Read a CSV file from disk and parse it.
///
/// # Arguments
/// * `path` - Path to the CSV file
/// * `max_rows` - Maximum number of data rows to return (None for unlimited)
///
/// # Returns
/// * `CsvData` with headers, rows, total_rows count, and truncated flag
pub async fn read_csv(path: &Path, max_rows: Option<usize>) -> Result<CsvData, CsvError> {
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| CsvError::ReadError {
            message: format!("Failed to read file '{}': {}", path.display(), e),
        })?;

    parse_csv_content(&content, max_rows)
}

/// Parse CSV content from a string.
///
/// # Arguments
/// * `content` - CSV content as a string
/// * `max_rows` - Maximum number of data rows to return (None for unlimited)
///
/// # Returns
/// * `CsvData` with headers, rows, total_rows count, and truncated flag
///
/// # Behavior
/// - Handles variable column counts (flexible parsing)
/// - Skips malformed rows with a warning (does not crash)
/// - Tracks total rows even when truncated
pub fn parse_csv_content(content: &str, max_rows: Option<usize>) -> Result<CsvData, CsvError> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true) // Allow variable column counts
        .has_headers(true)
        .trim(csv::Trim::All) // Trim whitespace from fields
        .from_reader(content.as_bytes());

    // Extract headers
    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| CsvError::ParseError {
            message: format!("Failed to parse CSV headers: {}", e),
        })?
        .iter()
        .map(|s| s.to_string())
        .collect();

    if headers.is_empty() {
        return Err(CsvError::ParseError {
            message: "CSV file has no headers".to_string(),
        });
    }

    let header_count = headers.len();
    let mut rows: Vec<CsvRow> = Vec::new();
    let mut total_rows: usize = 0;
    let mut skipped_rows: usize = 0;

    // Determine the effective row limit
    let row_limit = max_rows.unwrap_or(usize::MAX);

    for (line_number, result) in reader.records().enumerate() {
        match result {
            Ok(record) => {
                total_rows += 1;

                // Only collect rows up to the limit
                if rows.len() < row_limit {
                    // Normalize row to match header count
                    let row: CsvRow = normalize_row(&record, header_count);
                    rows.push(row);
                }
            }
            Err(e) => {
                // Skip malformed rows with a warning
                skipped_rows += 1;
                tracing::warn!(
                    "Skipping malformed row {} in CSV: {}",
                    line_number + 2, // +2 for 1-based indexing and header row
                    e
                );
            }
        }
    }

    if skipped_rows > 0 {
        tracing::info!(
            "CSV parsing complete: {} rows parsed, {} rows skipped due to errors",
            total_rows,
            skipped_rows
        );
    }

    let truncated = total_rows > rows.len();

    Ok(CsvData {
        headers,
        rows,
        total_rows,
        truncated,
    })
}

/// Normalize a CSV record to match the expected column count.
///
/// - If the record has fewer columns than headers, pad with empty strings
/// - If the record has more columns than headers, truncate
fn normalize_row(record: &csv::StringRecord, header_count: usize) -> CsvRow {
    let mut row: CsvRow = record.iter().map(|s| s.to_string()).collect();

    // Pad with empty strings if needed
    while row.len() < header_count {
        row.push(String::new());
    }

    // Truncate if too many columns
    row.truncate(header_count);

    row
}

// ============================================================================
// Type Inference
// ============================================================================

/// Infer the data type from a collection of string values.
///
/// Uses pattern matching to detect common data types in order of specificity.
/// For large datasets, samples a subset of values for efficiency.
///
/// # Arguments
/// * `values` - Slice of string values from a column
///
/// # Returns
/// * `DataType` - The inferred data type with any associated metadata
///
/// # Detection Order
/// 1. Boolean (true/false, yes/no, 1/0, on/off)
/// 2. Percentage (numeric values ending with %)
/// 3. Currency ($, EUR, GBP, USD prefix with numeric)
/// 4. Date (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY)
/// 5. DateTime (Date + time component)
/// 6. Integer (whole numbers, optional comma grouping)
/// 7. Decimal (floating point numbers)
/// 8. Enum (low cardinality <= 20 unique values)
/// 9. Text (fallback)
pub fn infer_data_type(values: &[String]) -> DataType {
    // Filter out empty values for analysis
    let non_empty: Vec<&str> = values
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    // If all values are empty, default to Text
    if non_empty.is_empty() {
        return DataType::Text;
    }

    // Sample values for large datasets
    let sample = sample_values(&non_empty);

    // Try each type detector in order of specificity
    if let Some(data_type) = try_detect_boolean(&sample) {
        return data_type;
    }

    if let Some(data_type) = try_detect_percentage(&sample) {
        return data_type;
    }

    if let Some(data_type) = try_detect_currency(&sample) {
        return data_type;
    }

    if let Some(data_type) = try_detect_datetime(&sample) {
        return data_type;
    }

    if let Some(data_type) = try_detect_date(&sample) {
        return data_type;
    }

    if let Some(data_type) = try_detect_integer(&sample) {
        return data_type;
    }

    if let Some(data_type) = try_detect_decimal(&sample) {
        return data_type;
    }

    // Check for enum (low cardinality) - use all non-empty values for accuracy
    if let Some(data_type) = try_detect_enum(&non_empty) {
        return data_type;
    }

    // Fallback to Text
    DataType::Text
}

/// Sample values from a large dataset for efficient type inference.
///
/// For datasets larger than TYPE_INFERENCE_SAMPLE_SIZE, takes an evenly
/// distributed sample across the dataset.
fn sample_values<'a>(values: &[&'a str]) -> Vec<&'a str> {
    if values.len() <= TYPE_INFERENCE_SAMPLE_SIZE {
        return values.to_vec();
    }

    let step = values.len() / TYPE_INFERENCE_SAMPLE_SIZE;
    values
        .iter()
        .step_by(step)
        .take(TYPE_INFERENCE_SAMPLE_SIZE)
        .copied()
        .collect()
}

/// Check if a sufficient percentage of values match a pattern.
fn meets_threshold(matches: usize, total: usize) -> bool {
    if total == 0 {
        return false;
    }
    (matches as f64 / total as f64) >= TYPE_MATCH_THRESHOLD
}

// ============================================================================
// Pattern Detectors
// ============================================================================

/// Detect boolean values (true/false, yes/no, 1/0, on/off, t/f, y/n)
fn try_detect_boolean(values: &[&str]) -> Option<DataType> {
    let boolean_patterns: HashSet<&str> = [
        "true", "false", "yes", "no", "1", "0", "on", "off", "t", "f", "y", "n",
    ]
    .into_iter()
    .collect();

    let matches = values
        .iter()
        .filter(|v| boolean_patterns.contains(v.to_lowercase().as_str()))
        .count();

    if meets_threshold(matches, values.len()) {
        Some(DataType::Boolean)
    } else {
        None
    }
}

/// Detect percentage values (numeric with % suffix)
fn try_detect_percentage(values: &[&str]) -> Option<DataType> {
    let percentage_regex = Regex::new(r"^-?\d+(?:,\d{3})*(?:\.\d+)?%$").unwrap();

    let matches = values
        .iter()
        .filter(|v| percentage_regex.is_match(v))
        .count();

    if meets_threshold(matches, values.len()) {
        Some(DataType::Percentage)
    } else {
        None
    }
}

/// Detect currency values and identify the currency code.
///
/// Supports:
/// - $ prefix (USD)
/// - EUR prefix or suffix
/// - GBP or pound sign prefix
/// - USD prefix
fn try_detect_currency(values: &[&str]) -> Option<DataType> {
    // Currency patterns with their associated codes
    let patterns = [
        (r"^\$-?\d+(?:,\d{3})*(?:\.\d+)?$", "USD"),
        (r"^-?\$\d+(?:,\d{3})*(?:\.\d+)?$", "USD"),
        (r"^USD\s*-?\d+(?:,\d{3})*(?:\.\d+)?$", "USD"),
        (r"^-?\d+(?:,\d{3})*(?:\.\d+)?\s*USD$", "USD"),
        (r"^EUR\s*-?\d+(?:,\d{3})*(?:\.\d+)?$", "EUR"),
        (r"^-?\d+(?:,\d{3})*(?:\.\d+)?\s*EUR$", "EUR"),
        (r"^\u{20AC}-?\d+(?:,\d{3})*(?:\.\d+)?$", "EUR"), // Euro sign
        (r"^GBP\s*-?\d+(?:,\d{3})*(?:\.\d+)?$", "GBP"),
        (r"^-?\d+(?:,\d{3})*(?:\.\d+)?\s*GBP$", "GBP"),
        (r"^\u{00A3}-?\d+(?:,\d{3})*(?:\.\d+)?$", "GBP"), // Pound sign
    ];

    for (pattern, code) in patterns {
        let regex = Regex::new(pattern).unwrap();
        let matches = values.iter().filter(|v| regex.is_match(v)).count();

        if meets_threshold(matches, values.len()) {
            return Some(DataType::Currency {
                code: code.to_string(),
            });
        }
    }

    None
}

/// Detect date values and identify the format.
///
/// Supports:
/// - YYYY-MM-DD (ISO 8601)
/// - MM/DD/YYYY (US format)
/// - DD/MM/YYYY (European format)
/// - YYYY/MM/DD
/// - DD-MM-YYYY
/// - MM-DD-YYYY
fn try_detect_date(values: &[&str]) -> Option<DataType> {
    let date_patterns = [
        (r"^\d{4}-\d{2}-\d{2}$", "YYYY-MM-DD"),
        (r"^\d{2}/\d{2}/\d{4}$", "MM/DD/YYYY"), // Could also be DD/MM/YYYY
        (r"^\d{4}/\d{2}/\d{2}$", "YYYY/MM/DD"),
        (r"^\d{2}-\d{2}-\d{4}$", "MM-DD-YYYY"), // Could also be DD-MM-YYYY
    ];

    for (pattern, format) in date_patterns {
        let regex = Regex::new(pattern).unwrap();
        let matches = values.iter().filter(|v| regex.is_match(v)).count();

        if meets_threshold(matches, values.len()) {
            // For ambiguous formats like MM/DD/YYYY vs DD/MM/YYYY,
            // try to disambiguate by checking value ranges
            let detected_format = if format == "MM/DD/YYYY" || format == "MM-DD-YYYY" {
                disambiguate_date_format(values, format)
            } else {
                format.to_string()
            };

            return Some(DataType::Date {
                format: detected_format,
            });
        }
    }

    None
}

/// Disambiguate between MM/DD/YYYY and DD/MM/YYYY formats.
///
/// Checks if first component ever exceeds 12 (must be day) or
/// if second component ever exceeds 12 (must be day).
fn disambiguate_date_format(values: &[&str], default_format: &str) -> String {
    let separator = if default_format.contains('/') {
        '/'
    } else {
        '-'
    };

    let mut first_exceeds_12 = false;
    let mut second_exceeds_12 = false;

    for value in values {
        let parts: Vec<&str> = value.split(separator).collect();
        if parts.len() >= 2 {
            if let Ok(first) = parts[0].parse::<u32>() {
                if first > 12 {
                    first_exceeds_12 = true;
                }
            }
            if let Ok(second) = parts[1].parse::<u32>() {
                if second > 12 {
                    second_exceeds_12 = true;
                }
            }
        }
    }

    if first_exceeds_12 && !second_exceeds_12 {
        // First part is day (DD/MM/YYYY)
        if separator == '/' {
            "DD/MM/YYYY".to_string()
        } else {
            "DD-MM-YYYY".to_string()
        }
    } else if second_exceeds_12 && !first_exceeds_12 {
        // Second part is day (MM/DD/YYYY)
        default_format.to_string()
    } else {
        // Can't disambiguate, use default (US format assumption)
        default_format.to_string()
    }
}

/// Detect datetime values and identify the format.
///
/// Supports common datetime formats with time components.
fn try_detect_datetime(values: &[&str]) -> Option<DataType> {
    // Order matters: more specific patterns first, T separator before space
    let datetime_patterns = [
        // ISO 8601 with T separator and optional timezone
        (
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$",
            "YYYY-MM-DDTHH:mm:ss",
        ),
        // Space-separated datetime (more common in databases)
        (
            r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$",
            "YYYY-MM-DD HH:mm:ss",
        ),
        (r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$", "YYYY-MM-DD HH:mm"),
        (
            r"^\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}$",
            "MM/DD/YYYY HH:mm:ss",
        ),
        (r"^\d{2}/\d{2}/\d{4} \d{2}:\d{2}$", "MM/DD/YYYY HH:mm"),
    ];

    for (pattern, format) in datetime_patterns {
        let regex = Regex::new(pattern).unwrap();
        let matches = values.iter().filter(|v| regex.is_match(v)).count();

        if meets_threshold(matches, values.len()) {
            return Some(DataType::DateTime {
                format: format.to_string(),
            });
        }
    }

    None
}

/// Detect integer values (whole numbers with optional comma grouping).
fn try_detect_integer(values: &[&str]) -> Option<DataType> {
    // Integer with optional comma grouping (e.g., 1,000,000)
    let integer_regex = Regex::new(r"^-?\d+(?:,\d{3})*$").unwrap();

    let matches = values.iter().filter(|v| integer_regex.is_match(v)).count();

    if meets_threshold(matches, values.len()) {
        Some(DataType::Integer)
    } else {
        None
    }
}

/// Detect decimal values and determine precision.
fn try_detect_decimal(values: &[&str]) -> Option<DataType> {
    // Decimal with optional comma grouping
    let decimal_regex = Regex::new(r"^-?\d+(?:,\d{3})*\.\d+$").unwrap();

    let matches = values.iter().filter(|v| decimal_regex.is_match(v)).count();

    if meets_threshold(matches, values.len()) {
        // Determine precision from decimal places
        let precision = determine_decimal_precision(values);
        Some(DataType::Decimal { precision })
    } else {
        None
    }
}

/// Determine the maximum decimal precision from a set of values.
fn determine_decimal_precision(values: &[&str]) -> Option<u8> {
    let mut max_precision: u8 = 0;

    for value in values {
        if let Some(decimal_pos) = value.rfind('.') {
            let decimal_places = (value.len() - decimal_pos - 1) as u8;
            if decimal_places > max_precision {
                max_precision = decimal_places;
            }
        }
    }

    if max_precision > 0 {
        Some(max_precision)
    } else {
        None
    }
}

/// Detect enum values (low cardinality categorical data).
///
/// If a column has <= ENUM_MAX_CARDINALITY unique values, it's likely an enum.
fn try_detect_enum(values: &[&str]) -> Option<DataType> {
    let unique_values: HashSet<&str> = values.iter().copied().collect();

    // Only treat as enum if cardinality is low and there are multiple values
    if unique_values.len() <= ENUM_MAX_CARDINALITY && unique_values.len() > 1 {
        // Don't treat single-character values as enums (likely codes or flags)
        // unless they're clearly categorical (all same length, non-numeric)
        let all_single_char = unique_values.iter().all(|v| v.len() == 1);
        let all_numeric = unique_values
            .iter()
            .all(|v| v.chars().all(|c| c.is_ascii_digit()));

        // Skip if all values are single digits (likely codes, not enums)
        if all_single_char && all_numeric {
            return None;
        }

        let mut values_vec: Vec<String> = unique_values.iter().map(|s| s.to_string()).collect();
        values_vec.sort();

        Some(DataType::Enum { values: values_vec })
    } else {
        None
    }
}

/// Infer the data type for a column and return with format hints.
///
/// This is a convenience wrapper that returns both the DataType
/// and any applicable FormatHint for display purposes.
pub fn infer_data_type_with_hint(values: &[String]) -> (DataType, Option<FormatHint>) {
    let data_type = infer_data_type(values);

    let format_hint = match &data_type {
        DataType::Date { format } => Some(FormatHint {
            pattern: Some(format.clone()),
            locale: None,
            timezone: None,
        }),
        DataType::DateTime { format } => Some(FormatHint {
            pattern: Some(format.clone()),
            locale: None,
            timezone: None,
        }),
        DataType::Currency { code } => Some(FormatHint {
            pattern: Some(format!("{} #,##0.00", code)),
            locale: match code.as_str() {
                "USD" => Some("en-US".to_string()),
                "EUR" => Some("de-DE".to_string()),
                "GBP" => Some("en-GB".to_string()),
                _ => None,
            },
            timezone: None,
        }),
        DataType::Percentage => Some(FormatHint {
            pattern: Some("#,##0.00%".to_string()),
            locale: None,
            timezone: None,
        }),
        DataType::Decimal { precision } => {
            let decimal_places = precision.unwrap_or(2);
            let zeros = "0".repeat(decimal_places as usize);
            Some(FormatHint {
                pattern: Some(format!("#,##0.{}", zeros)),
                locale: None,
                timezone: None,
            })
        }
        DataType::Integer => Some(FormatHint {
            pattern: Some("#,##0".to_string()),
            locale: None,
            timezone: None,
        }),
        _ => None,
    };

    (data_type, format_hint)
}

// ============================================================================
// Semantic Role Inference
// ============================================================================

/// Infer the semantic role of a column based on its name and data type.
///
/// Uses pattern matching on column names to determine the semantic purpose
/// of the column, with data type as a fallback for ambiguous cases.
///
/// # Arguments
/// * `name` - The column name to analyze
/// * `data_type` - The inferred data type of the column
///
/// # Returns
/// * `SemanticRole` - The inferred semantic role
///
/// # Detection Order (name-based, most specific first)
/// 1. Identifier: ends with _id, id, _key, key, _uuid, uuid, _code
/// 2. Temporal: ends with _at, _date, _time, or contains date/time/timestamp
/// 3. Measure: contains amount, total, count, price, revenue, cost, sum, qty, quantity
/// 4. Dimension: contains category, type, region, status, state, country, city, segment
/// 5. Descriptive: contains note, comment, description, remarks, memo
/// 6. Data type fallback (Currency/Decimal/Integer -> Measure, Date/DateTime -> Temporal, Enum -> Dimension)
/// 7. Unknown: final fallback
pub fn infer_semantic_role(name: &str, data_type: &DataType) -> SemanticRole {
    let name_lower = name.to_lowercase();

    // 1. Check for Identifier patterns (most specific)
    if is_identifier_column(&name_lower) {
        return SemanticRole::Identifier;
    }

    // 2. Check for Temporal patterns
    if is_temporal_column(&name_lower) {
        return SemanticRole::Temporal;
    }

    // 3. Check for Measure patterns
    if is_measure_column(&name_lower) {
        return SemanticRole::Measure;
    }

    // 4. Check for Dimension patterns
    if is_dimension_column(&name_lower) {
        return SemanticRole::Dimension;
    }

    // 5. Check for Descriptive patterns
    if is_descriptive_column(&name_lower) {
        return SemanticRole::Descriptive;
    }

    // 6. Fall back to data type inference
    infer_role_from_data_type(data_type)
}

/// Check if column name suggests an identifier/primary key.
fn is_identifier_column(name: &str) -> bool {
    // Check suffix patterns (more specific)
    let id_suffixes = ["_id", "_key", "_uuid", "_code"];
    for suffix in id_suffixes {
        if name.ends_with(suffix) {
            return true;
        }
    }

    // Check exact matches or simple endings
    if name == "id" || name == "key" || name == "uuid" || name == "code" {
        return true;
    }

    // Check if name ends with "id" (e.g., "customerid", "userid")
    // but not words that happen to end in "id" (e.g., "paid", "valid")
    if name.ends_with("id") && name.len() > 2 {
        let prefix = &name[..name.len() - 2];
        // Check if prefix ends with underscore or is alphanumeric (likely an ID)
        if prefix.ends_with('_') || prefix.chars().all(|c| c.is_alphanumeric()) {
            // Exclude common false positives
            let false_positives = ["paid", "valid", "void", "grid", "fluid", "solid", "rapid"];
            if !false_positives.contains(&name) {
                return true;
            }
        }
    }

    false
}

/// Check if column name suggests a temporal/date field.
fn is_temporal_column(name: &str) -> bool {
    // Check suffix patterns
    let temporal_suffixes = ["_at", "_date", "_time", "_datetime", "_timestamp"];
    for suffix in temporal_suffixes {
        if name.ends_with(suffix) {
            return true;
        }
    }

    // Check contains patterns
    let temporal_keywords = ["date", "time", "timestamp", "datetime"];
    for keyword in temporal_keywords {
        if name.contains(keyword) {
            return true;
        }
    }

    // Check common temporal column names
    let temporal_names = [
        "created", "updated", "modified", "deleted", "expired", "started", "ended",
    ];
    for temporal_name in temporal_names {
        if name == temporal_name || name.starts_with(&format!("{}_", temporal_name)) {
            return true;
        }
    }

    false
}

/// Check if column name suggests a measure/numeric aggregation field.
fn is_measure_column(name: &str) -> bool {
    // Use word boundary matching to avoid false positives
    // e.g., "count" should match but "country" should not
    let measure_keywords = [
        "amount", "total", "price", "revenue", "sum", "qty", "quantity", "balance", "rate", "fee",
        "tax", "discount", "profit", "margin", "value", "score", "weight", "height", "width",
        "length", "size", "salary", "income", "expense", "budget",
    ];

    for keyword in measure_keywords {
        if name.contains(keyword) {
            return true;
        }
    }

    // Special handling for "count" and "cost" to avoid false positives
    // (e.g., "country" contains "count", "accosting" contains "cost")
    if contains_word(name, "count") || contains_word(name, "cost") || contains_word(name, "age") {
        return true;
    }

    false
}

/// Check if a word appears in a name at word boundaries.
/// Words are separated by underscores or are at the start/end of the string.
fn contains_word(name: &str, word: &str) -> bool {
    // Check exact match
    if name == word {
        return true;
    }

    // Check for word at start (e.g., "count_total" matches "count")
    if name.starts_with(&format!("{}_", word)) {
        return true;
    }

    // Check for word at end (e.g., "item_count" matches "count")
    if name.ends_with(&format!("_{}", word)) {
        return true;
    }

    // Check for word in middle (e.g., "item_count_total" matches "count")
    if name.contains(&format!("_{}_", word)) {
        return true;
    }

    false
}

/// Check if column name suggests a dimension/categorical field.
fn is_dimension_column(name: &str) -> bool {
    let dimension_keywords = [
        "category",
        "type",
        "region",
        "status",
        "state",
        "country",
        "city",
        "segment",
        "group",
        "class",
        "tier",
        "level",
        "department",
        "division",
        "brand",
        "vendor",
        "supplier",
        "channel",
        "source",
        "medium",
        "campaign",
        "gender",
        "industry",
        "sector",
    ];

    for keyword in dimension_keywords {
        if name.contains(keyword) {
            return true;
        }
    }

    false
}

/// Check if column name suggests a descriptive/text field.
fn is_descriptive_column(name: &str) -> bool {
    let descriptive_keywords = [
        "note",
        "comment",
        "description",
        "remarks",
        "memo",
        "summary",
        "detail",
        "info",
        "text",
        "content",
        "body",
        "message",
    ];

    for keyword in descriptive_keywords {
        if name.contains(keyword) {
            return true;
        }
    }

    // Check for "name" separately to avoid matching "filename", etc.
    // Only match if "name" is the full name or at a word boundary
    if name == "name" || name.ends_with("_name") || name.starts_with("name_") {
        return true;
    }

    false
}

/// Infer semantic role from data type when name patterns don't match.
fn infer_role_from_data_type(data_type: &DataType) -> SemanticRole {
    match data_type {
        // Numeric types default to Measure
        DataType::Currency { .. } => SemanticRole::Measure,
        DataType::Decimal { .. } => SemanticRole::Measure,
        DataType::Integer => SemanticRole::Measure,
        DataType::Percentage => SemanticRole::Measure,

        // Date/time types default to Temporal
        DataType::Date { .. } => SemanticRole::Temporal,
        DataType::DateTime { .. } => SemanticRole::Temporal,

        // Enum types default to Dimension
        DataType::Enum { .. } => SemanticRole::Dimension,

        // Boolean could be either, default to Dimension
        DataType::Boolean => SemanticRole::Dimension,

        // Text is Unknown
        DataType::Text => SemanticRole::Unknown,
    }
}

// ============================================================================
// Schema Inference
// ============================================================================

/// Maximum number of sample values to collect for column metadata
const MAX_SAMPLE_VALUES: usize = 5;

/// Infer a complete CSV schema from parsed data.
///
/// This function combines type inference, semantic role detection, and statistics
/// calculation to generate a full schema for a CSV file.
///
/// # Arguments
/// * `path` - Path to the CSV file (used for source_file in schema)
/// * `data` - Parsed CSV data with headers and rows
/// * `existing` - Optional existing schema to preserve user-edited descriptions
///
/// # Returns
/// * `CsvSchema` - Complete schema with column definitions and metadata
pub fn infer_schema(path: &str, data: &CsvData, existing: Option<&CsvSchema>) -> CsvSchema {
    // Build a map of existing column descriptions for preservation
    let existing_descriptions: HashMap<String, String> = existing
        .map(|schema| {
            schema
                .columns
                .iter()
                .map(|col| (col.name.clone(), col.description.clone()))
                .collect()
        })
        .unwrap_or_default();

    // Build a map of existing display names for preservation
    let existing_display_names: HashMap<String, Option<String>> = existing
        .map(|schema| {
            schema
                .columns
                .iter()
                .map(|col| (col.name.clone(), col.display_name.clone()))
                .collect()
        })
        .unwrap_or_default();

    // Extract column values for each header
    let column_values: Vec<Vec<String>> = (0..data.headers.len())
        .map(|col_idx| {
            data.rows
                .iter()
                .map(|row| row.get(col_idx).cloned().unwrap_or_default())
                .collect()
        })
        .collect();

    // Generate column schemas
    let columns: Vec<ColumnSchema> = data
        .headers
        .iter()
        .enumerate()
        .map(|(idx, name)| {
            let values = &column_values[idx];

            // Infer data type and format hint
            let (data_type, format_hint) = infer_data_type_with_hint(values);

            // Infer semantic role
            let semantic_role = infer_semantic_role(name, &data_type);

            // Compute column metadata (statistics)
            let metadata = compute_column_metadata(values, &data_type);

            // Check if user has edited the description
            let description = if let Some(existing_desc) = existing_descriptions.get(name) {
                // Check if it's a user-edited description (not auto-generated)
                let auto_generated = generate_description(name, &data_type, &semantic_role);
                if existing_desc != &auto_generated && !existing_desc.is_empty() {
                    // User has edited, preserve it
                    existing_desc.clone()
                } else {
                    // Auto-generated or empty, regenerate
                    auto_generated
                }
            } else {
                generate_description(name, &data_type, &semantic_role)
            };

            // Preserve display name if it exists
            let display_name = existing_display_names.get(name).cloned().flatten();

            ColumnSchema {
                name: name.clone(),
                display_name,
                description,
                data_type,
                semantic_role,
                format: format_hint,
                metadata,
            }
        })
        .collect();

    // Compute content hash (simple hash of headers + row count for now)
    let mut hasher = Sha256::new();
    hasher.update(format!("{:?}-{}", data.headers, data.total_rows).as_bytes());
    let content_hash = format!("{:x}", hasher.finalize());

    // Get current timestamp
    let updated_at = chrono::Utc::now().to_rfc3339();

    // Preserve existing relationships and metadata if available
    let relationships = existing
        .map(|s| s.relationships.clone())
        .unwrap_or_default();

    let metadata = existing
        .map(|s| s.metadata.clone())
        .unwrap_or_else(|| DatasetMetadata {
            description: format!(
                "CSV file with {} columns and {} rows",
                data.headers.len(),
                data.total_rows
            ),
            tags: Vec::new(),
            source: None,
            owner: None,
            notes: None,
        });

    CsvSchema {
        version: 1,
        source_file: path.to_string(),
        content_hash,
        updated_at,
        columns,
        relationships,
        metadata,
        read_only: false,
    }
}

/// Compute column metadata including statistics from column values.
///
/// # Arguments
/// * `values` - All values from the column
/// * `data_type` - The inferred data type of the column
///
/// # Returns
/// * `ColumnMetadata` - Statistics and metadata for the column
pub fn compute_column_metadata(values: &[String], data_type: &DataType) -> ColumnMetadata {
    // Filter non-empty values
    let non_empty: Vec<&str> = values
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let non_null_count = non_empty.len();
    let nullable = non_null_count < values.len();

    // Calculate unique values
    let unique_values: HashSet<&str> = non_empty.iter().copied().collect();
    let unique_count = unique_values.len();
    let unique = unique_count == non_null_count && non_null_count > 0;

    // Collect sample values (max 5 unique non-empty values)
    let mut samples: Vec<String> = unique_values
        .iter()
        .take(MAX_SAMPLE_VALUES)
        .map(|s| s.to_string())
        .collect();
    samples.sort();

    // Calculate numeric statistics if applicable
    let (min_value, max_value, numeric_stats) = compute_numeric_stats(&non_empty, data_type);

    ColumnMetadata {
        nullable,
        unique,
        examples: samples,
        min_value,
        max_value,
        distinct_count: Some(unique_count),
        non_null_count: Some(non_null_count),
        numeric_stats,
    }
}

/// Compute numeric statistics for numeric column types.
///
/// # Arguments
/// * `values` - Non-empty string values from the column
/// * `data_type` - The data type of the column
///
/// # Returns
/// * Tuple of (min_value as string, max_value as string, NumericStats if numeric)
fn compute_numeric_stats(
    values: &[&str],
    data_type: &DataType,
) -> (Option<String>, Option<String>, Option<NumericStats>) {
    // Only compute for numeric types
    let is_numeric = matches!(
        data_type,
        DataType::Integer
            | DataType::Decimal { .. }
            | DataType::Currency { .. }
            | DataType::Percentage
    );

    if !is_numeric || values.is_empty() {
        return (None, None, None);
    }

    // Parse numeric values
    let parsed: Vec<f64> = values
        .iter()
        .filter_map(|v| parse_numeric_value(v, data_type))
        .collect();

    if parsed.is_empty() {
        return (None, None, None);
    }

    let min = parsed.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = parsed.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let sum: f64 = parsed.iter().sum();
    let mean = sum / parsed.len() as f64;

    let stats = NumericStats {
        min,
        max,
        mean,
        sum,
    };

    // Format min/max as strings for display
    let min_str = format_numeric_value(min, data_type);
    let max_str = format_numeric_value(max, data_type);

    (Some(min_str), Some(max_str), Some(stats))
}

/// Parse a string value to f64 based on data type.
fn parse_numeric_value(value: &str, data_type: &DataType) -> Option<f64> {
    let cleaned = match data_type {
        DataType::Currency { .. } => {
            // Remove currency symbols and commas
            value
                .replace(['$', '£', '\u{20AC}'], "")
                .replace("USD", "")
                .replace("EUR", "")
                .replace("GBP", "")
                .replace(',', "")
                .trim()
                .to_string()
        }
        DataType::Percentage => {
            // Remove % and commas
            value.replace('%', "").replace(',', "").trim().to_string()
        }
        DataType::Integer | DataType::Decimal { .. } => {
            // Remove commas
            value.replace(',', "").trim().to_string()
        }
        _ => value.to_string(),
    };

    cleaned.parse::<f64>().ok()
}

/// Format a numeric value back to string based on data type.
fn format_numeric_value(value: f64, data_type: &DataType) -> String {
    match data_type {
        DataType::Integer => format!("{}", value as i64),
        DataType::Decimal { precision } => {
            let prec = precision.unwrap_or(2) as usize;
            format!("{:.prec$}", value, prec = prec)
        }
        DataType::Currency { code } => {
            format!("{} {:.2}", code, value)
        }
        DataType::Percentage => {
            format!("{:.2}%", value)
        }
        _ => format!("{}", value),
    }
}

/// Generate a default description for a column based on its characteristics.
///
/// # Arguments
/// * `name` - Column name
/// * `data_type` - Inferred data type
/// * `role` - Inferred semantic role
///
/// # Returns
/// * Human-readable description string
pub fn generate_description(name: &str, data_type: &DataType, role: &SemanticRole) -> String {
    // Convert name to human-readable format
    let readable_name = name
        .replace('_', " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().chain(chars).collect(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    let type_desc = match data_type {
        DataType::Text => "text",
        DataType::Integer => "integer",
        DataType::Decimal { .. } => "decimal number",
        DataType::Currency { code } => return format!("{} in {} currency", readable_name, code),
        DataType::Date { format } => return format!("{} date ({})", readable_name, format),
        DataType::DateTime { format } => {
            return format!("{} timestamp ({})", readable_name, format)
        }
        DataType::Boolean => "boolean flag",
        DataType::Percentage => "percentage",
        DataType::Enum { values } => {
            if values.len() <= 5 {
                return format!(
                    "{} category with values: {}",
                    readable_name,
                    values.join(", ")
                );
            } else {
                return format!(
                    "{} category with {} possible values",
                    readable_name,
                    values.len()
                );
            }
        }
    };

    let role_desc = match role {
        SemanticRole::Identifier => "unique identifier",
        SemanticRole::Dimension => "categorical dimension",
        SemanticRole::Measure => "numeric measure",
        SemanticRole::Temporal => "temporal field",
        SemanticRole::Reference { .. } => "foreign key reference",
        SemanticRole::Descriptive => "descriptive text",
        SemanticRole::Unknown => type_desc,
    };

    if matches!(role, SemanticRole::Unknown) {
        format!("{} ({})", readable_name, type_desc)
    } else {
        format!("{} - {} ({})", readable_name, role_desc, type_desc)
    }
}

// ============================================================================
// AI Context Generation
// ============================================================================

/// Default maximum number of sample rows for AI context
const DEFAULT_MAX_SAMPLE_ROWS: usize = 10;

/// Generate AI-optimized context from a CSV schema and data.
///
/// This function creates a structured context format optimized for LLM consumption,
/// including schema summaries, column descriptions, sample data as markdown,
/// and relationship information.
///
/// # Arguments
/// * `path` - Path to the CSV file
/// * `schema` - The CSV schema with column definitions
/// * `data` - The parsed CSV data
/// * `max_sample_rows` - Maximum number of sample rows to include (default: 10)
///
/// # Returns
/// * `CsvAiContext` - AI-optimized context for the CSV file
pub fn generate_ai_context(
    path: &str,
    schema: &CsvSchema,
    data: &CsvData,
    max_sample_rows: Option<usize>,
) -> CsvAiContext {
    let max_rows = max_sample_rows.unwrap_or(DEFAULT_MAX_SAMPLE_ROWS);

    // Generate schema summary
    let schema_summary = generate_schema_summary(path, data, schema);

    // Convert columns to AI context format
    let columns: Vec<ColumnAiContext> = schema.columns.iter().map(column_to_ai_context).collect();

    // Generate sample data as markdown table
    let sample_data = generate_sample_data_markdown(data, max_rows);

    // Convert relationships to AI context format
    let relationships: Vec<RelationshipAiContext> = schema
        .relationships
        .iter()
        .map(relationship_to_ai_context)
        .collect();

    CsvAiContext {
        file_path: path.to_string(),
        description: schema.metadata.description.clone(),
        schema_summary,
        columns,
        sample_data,
        relationships,
    }
}

/// Generate a human-readable schema summary for AI context.
///
/// # Arguments
/// * `path` - Path to the CSV file
/// * `data` - The parsed CSV data
/// * `schema` - The CSV schema
///
/// # Returns
/// * A markdown-formatted summary string
fn generate_schema_summary(path: &str, data: &CsvData, schema: &CsvSchema) -> String {
    // Extract file name from path
    let file_name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path);

    // Count columns by semantic role
    let mut role_counts: HashMap<&str, usize> = HashMap::new();
    for col in &schema.columns {
        let role_name = semantic_role_to_string(&col.semantic_role);
        *role_counts.entry(role_name).or_insert(0) += 1;
    }

    // Build role summary
    let role_summary: Vec<String> = role_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .map(|(role, count)| format!("{} {}", count, role))
        .collect();

    let role_str = if role_summary.is_empty() {
        String::new()
    } else {
        format!(" ({})", role_summary.join(", "))
    };

    format!(
        "**{}**: {} rows, {} columns{}",
        file_name,
        data.total_rows,
        schema.columns.len(),
        role_str
    )
}

/// Convert a ColumnSchema to ColumnAiContext.
///
/// Transforms the internal column schema representation into a human-readable
/// format optimized for AI consumption.
///
/// # Arguments
/// * `column` - The column schema to convert
///
/// # Returns
/// * `ColumnAiContext` - AI-friendly column representation
fn column_to_ai_context(column: &ColumnSchema) -> ColumnAiContext {
    ColumnAiContext {
        name: column
            .display_name
            .clone()
            .unwrap_or_else(|| column.name.clone()),
        data_type: data_type_to_string(&column.data_type),
        role: semantic_role_to_string(&column.semantic_role).to_string(),
        description: column.description.clone(),
        examples: column.metadata.examples.clone(),
    }
}

/// Convert a DataType enum to a human-readable string.
///
/// # Arguments
/// * `data_type` - The data type to convert
///
/// # Returns
/// * A human-readable string describing the data type
fn data_type_to_string(data_type: &DataType) -> String {
    match data_type {
        DataType::Text => "text".to_string(),
        DataType::Integer => "integer".to_string(),
        DataType::Decimal { precision } => match precision {
            Some(p) => format!("decimal (precision: {})", p),
            None => "decimal".to_string(),
        },
        DataType::Currency { code } => format!("currency ({})", code),
        DataType::Date { format } => format!("date (format: {})", format),
        DataType::DateTime { format } => format!("datetime (format: {})", format),
        DataType::Boolean => "boolean".to_string(),
        DataType::Percentage => "percentage".to_string(),
        DataType::Enum { values } => {
            if values.len() <= 5 {
                format!("enum [{}]", values.join(", "))
            } else {
                format!("enum ({} values)", values.len())
            }
        }
    }
}

/// Convert a SemanticRole enum to a human-readable string.
///
/// # Arguments
/// * `role` - The semantic role to convert
///
/// # Returns
/// * A static string describing the semantic role
fn semantic_role_to_string(role: &SemanticRole) -> &'static str {
    match role {
        SemanticRole::Identifier => "identifier",
        SemanticRole::Dimension => "dimension",
        SemanticRole::Measure => "measure",
        SemanticRole::Temporal => "temporal",
        SemanticRole::Reference { .. } => "reference",
        SemanticRole::Descriptive => "descriptive",
        SemanticRole::Unknown => "unknown",
    }
}

/// Convert a Relationship to RelationshipAiContext.
///
/// Transforms the internal relationship representation into a human-readable
/// format for AI consumption.
///
/// # Arguments
/// * `relationship` - The relationship to convert
///
/// # Returns
/// * `RelationshipAiContext` - AI-friendly relationship representation
fn relationship_to_ai_context(relationship: &Relationship) -> RelationshipAiContext {
    let cardinality_str = cardinality_to_string(&relationship.cardinality);

    let description = format!(
        "{}: {} -> {}.{} ({})",
        relationship.name,
        relationship.local_column,
        relationship.foreign_file,
        relationship.foreign_column,
        cardinality_str
    );

    let foreign_reference = format!(
        "{}.{}",
        relationship.foreign_file, relationship.foreign_column
    );

    RelationshipAiContext {
        description,
        local_column: relationship.local_column.clone(),
        foreign_reference,
    }
}

/// Convert a Cardinality enum to a human-readable string.
///
/// # Arguments
/// * `cardinality` - The cardinality type to convert
///
/// # Returns
/// * A static string describing the cardinality
fn cardinality_to_string(cardinality: &Cardinality) -> &'static str {
    match cardinality {
        Cardinality::OneToOne => "one-to-one",
        Cardinality::OneToMany => "one-to-many",
        Cardinality::ManyToOne => "many-to-one",
        Cardinality::ManyToMany => "many-to-many",
    }
}

/// Generate sample data as a markdown table.
///
/// Creates a properly formatted markdown table from the CSV data,
/// limited to the specified maximum number of rows.
///
/// # Arguments
/// * `data` - The parsed CSV data
/// * `max_rows` - Maximum number of sample rows to include
///
/// # Returns
/// * A markdown-formatted table string
fn generate_sample_data_markdown(data: &CsvData, max_rows: usize) -> String {
    if data.headers.is_empty() {
        return String::new();
    }

    let mut markdown = String::new();

    // Header row
    markdown.push_str("| ");
    markdown.push_str(&data.headers.join(" | "));
    markdown.push_str(" |\n");

    // Separator row
    markdown.push_str("| ");
    let separators: Vec<&str> = data.headers.iter().map(|_| "---").collect();
    markdown.push_str(&separators.join(" | "));
    markdown.push_str(" |\n");

    // Data rows (limited to max_rows)
    let rows_to_show = data.rows.iter().take(max_rows);
    for row in rows_to_show {
        markdown.push_str("| ");
        // Escape pipe characters in cell values and truncate long values
        let escaped_cells: Vec<String> = row
            .iter()
            .map(|cell| {
                let escaped = cell.replace('|', "\\|");
                if escaped.len() > 50 {
                    format!("{}...", &escaped[..47])
                } else {
                    escaped
                }
            })
            .collect();
        markdown.push_str(&escaped_cells.join(" | "));
        markdown.push_str(" |\n");
    }

    // Add truncation notice if applicable
    if data.rows.len() > max_rows {
        markdown.push_str(&format!(
            "\n*Showing {} of {} rows*",
            max_rows,
            data.rows.len()
        ));
    }

    markdown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic_csv() {
        let content = "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago";
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.headers, vec!["name", "age", "city"]);
        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.total_rows, 3);
        assert!(!result.truncated);

        assert_eq!(result.rows[0], vec!["Alice", "30", "NYC"]);
        assert_eq!(result.rows[1], vec!["Bob", "25", "LA"]);
        assert_eq!(result.rows[2], vec!["Charlie", "35", "Chicago"]);
    }

    #[test]
    fn test_parse_csv_with_max_rows() {
        let content = "id,value\n1,a\n2,b\n3,c\n4,d\n5,e";
        let result = parse_csv_content(content, Some(3)).unwrap();

        assert_eq!(result.headers, vec!["id", "value"]);
        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.total_rows, 5);
        assert!(result.truncated);

        assert_eq!(result.rows[0], vec!["1", "a"]);
        assert_eq!(result.rows[1], vec!["2", "b"]);
        assert_eq!(result.rows[2], vec!["3", "c"]);
    }

    #[test]
    fn test_parse_csv_variable_columns() {
        // Row 2 has fewer columns, row 3 has more columns
        let content = "a,b,c\n1,2,3\n4,5\n6,7,8,9";
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.headers, vec!["a", "b", "c"]);
        assert_eq!(result.rows.len(), 3);

        assert_eq!(result.rows[0], vec!["1", "2", "3"]);
        assert_eq!(result.rows[1], vec!["4", "5", ""]); // Padded with empty string
        assert_eq!(result.rows[2], vec!["6", "7", "8"]); // Truncated to 3 columns
    }

    #[test]
    fn test_parse_csv_with_quotes() {
        let content = r#"name,description
"John Doe","A person with a comma, in the description"
"Jane","Simple description""#;
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.headers, vec!["name", "description"]);
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0][0], "John Doe");
        assert_eq!(
            result.rows[0][1],
            "A person with a comma, in the description"
        );
    }

    #[test]
    fn test_parse_csv_trims_whitespace() {
        let content = "  name  ,  age  \n  Alice  ,  30  ";
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.headers, vec!["name", "age"]);
        assert_eq!(result.rows[0], vec!["Alice", "30"]);
    }

    #[test]
    fn test_parse_empty_csv_fails() {
        let content = "";
        let result = parse_csv_content(content, None);

        assert!(result.is_err());
        match result {
            Err(CsvError::ParseError { message }) => {
                assert!(message.contains("headers"));
            }
            _ => panic!("Expected ParseError"),
        }
    }

    #[test]
    fn test_parse_csv_headers_only() {
        let content = "col1,col2,col3";
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.headers, vec!["col1", "col2", "col3"]);
        assert_eq!(result.rows.len(), 0);
        assert_eq!(result.total_rows, 0);
        assert!(!result.truncated);
    }

    #[test]
    fn test_max_rows_zero() {
        let content = "a,b\n1,2\n3,4";
        let result = parse_csv_content(content, Some(0)).unwrap();

        assert_eq!(result.headers, vec!["a", "b"]);
        assert_eq!(result.rows.len(), 0);
        assert_eq!(result.total_rows, 2);
        assert!(result.truncated);
    }

    #[tokio::test]
    async fn test_read_csv_file_not_found() {
        let result = read_csv(Path::new("/nonexistent/file.csv"), None).await;

        assert!(result.is_err());
        match result {
            Err(CsvError::ReadError { message }) => {
                assert!(message.contains("Failed to read file"));
            }
            _ => panic!("Expected ReadError"),
        }
    }

    // ========================================================================
    // Type Inference Tests
    // ========================================================================

    #[test]
    fn test_infer_integer_column() {
        let values: Vec<String> = vec!["1", "2", "3", "100", "1000"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Integer));
    }

    #[test]
    fn test_infer_integer_with_commas() {
        let values: Vec<String> = vec!["1,000", "2,500", "10,000", "1,000,000"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Integer));
    }

    #[test]
    fn test_infer_negative_integers() {
        let values: Vec<String> = vec!["-1", "-100", "50", "-1,000"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Integer));
    }

    #[test]
    fn test_infer_decimal_column() {
        let values: Vec<String> = vec!["1.5", "2.75", "3.0", "100.99"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Decimal { precision: Some(2) }));
    }

    #[test]
    fn test_infer_decimal_precision() {
        let values: Vec<String> = vec!["1.123", "2.456", "3.789"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Decimal { precision: Some(3) }));
    }

    #[test]
    fn test_infer_currency_usd() {
        let values: Vec<String> = vec!["$100.00", "$50.25", "$1,000.00"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Currency { code } if code == "USD"));
    }

    #[test]
    fn test_infer_currency_eur() {
        let values: Vec<String> = vec!["100 EUR", "50.25 EUR", "1000 EUR"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Currency { code } if code == "EUR"));
    }

    #[test]
    fn test_infer_currency_gbp() {
        let values: Vec<String> = vec!["GBP 100.00", "GBP 50.25", "GBP 1000"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Currency { code } if code == "GBP"));
    }

    #[test]
    fn test_infer_date_iso() {
        let values: Vec<String> = vec!["2024-01-15", "2024-02-20", "2023-12-31"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Date { format } if format == "YYYY-MM-DD"));
    }

    #[test]
    fn test_infer_date_us_format() {
        let values: Vec<String> = vec!["01/15/2024", "02/20/2024", "12/31/2023"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Date { format } if format == "MM/DD/YYYY"));
    }

    #[test]
    fn test_infer_date_european_format() {
        // When first component > 12, it must be day (DD/MM/YYYY)
        let values: Vec<String> = vec!["15/01/2024", "20/02/2024", "31/12/2023"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Date { format } if format == "DD/MM/YYYY"));
    }

    #[test]
    fn test_infer_datetime_iso() {
        let values: Vec<String> = vec![
            "2024-01-15T10:30:00",
            "2024-02-20T14:45:30",
            "2023-12-31T23:59:59",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::DateTime { format } if format == "YYYY-MM-DDTHH:mm:ss"));
    }

    #[test]
    fn test_infer_datetime_space_separator() {
        let values: Vec<String> = vec![
            "2024-01-15 10:30:00",
            "2024-02-20 14:45:30",
            "2023-12-31 23:59:59",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::DateTime { format } if format == "YYYY-MM-DD HH:mm:ss"));
    }

    #[test]
    fn test_infer_boolean_true_false() {
        let values: Vec<String> = vec!["true", "false", "true", "false"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Boolean));
    }

    #[test]
    fn test_infer_boolean_yes_no() {
        let values: Vec<String> = vec!["yes", "no", "Yes", "NO", "YES"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Boolean));
    }

    #[test]
    fn test_infer_boolean_one_zero() {
        let values: Vec<String> = vec!["1", "0", "1", "0", "1", "0", "1", "0", "1", "0"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Boolean));
    }

    #[test]
    fn test_infer_percentage() {
        let values: Vec<String> = vec!["50%", "25.5%", "100%", "0%"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Percentage));
    }

    #[test]
    fn test_infer_enum_status() {
        let values: Vec<String> = vec![
            "Active", "Inactive", "Pending", "Active", "Pending", "Inactive",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        match result {
            DataType::Enum { values } => {
                assert_eq!(values.len(), 3);
                assert!(values.contains(&"Active".to_string()));
                assert!(values.contains(&"Inactive".to_string()));
                assert!(values.contains(&"Pending".to_string()));
            }
            _ => panic!("Expected Enum type, got {:?}", result),
        }
    }

    #[test]
    fn test_infer_enum_categories() {
        let values: Vec<String> = vec![
            "Electronics",
            "Clothing",
            "Food",
            "Electronics",
            "Clothing",
            "Food",
            "Electronics",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        match result {
            DataType::Enum { values } => {
                assert_eq!(values.len(), 3);
            }
            _ => panic!("Expected Enum type"),
        }
    }

    #[test]
    fn test_infer_text_high_cardinality() {
        // More than 20 unique values should be Text, not Enum
        let values: Vec<String> = (1..=25).map(|i| format!("unique_value_{}", i)).collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Text));
    }

    #[test]
    fn test_infer_text_fallback() {
        let values: Vec<String> = vec![
            "Hello world",
            "This is text",
            "Random string 123",
            "Another value",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        // With only 4 unique values, could be Enum
        match result {
            DataType::Text | DataType::Enum { .. } => {}
            _ => panic!("Expected Text or Enum type"),
        }
    }

    #[test]
    fn test_infer_empty_values() {
        let values: Vec<String> = vec!["", "", ""].into_iter().map(String::from).collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Text));
    }

    #[test]
    fn test_infer_mixed_empty_and_values() {
        // Empty values should be ignored for type detection
        let values: Vec<String> = vec!["100", "", "200", "", "300"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Integer));
    }

    #[test]
    fn test_infer_type_with_hint_date() {
        let values: Vec<String> = vec!["2024-01-15", "2024-02-20", "2023-12-31"]
            .into_iter()
            .map(String::from)
            .collect();
        let (data_type, hint) = infer_data_type_with_hint(&values);
        assert!(matches!(data_type, DataType::Date { format } if format == "YYYY-MM-DD"));
        assert!(hint.is_some());
        assert_eq!(hint.unwrap().pattern, Some("YYYY-MM-DD".to_string()));
    }

    #[test]
    fn test_infer_type_with_hint_currency() {
        let values: Vec<String> = vec!["$100.00", "$50.25", "$1,000.00"]
            .into_iter()
            .map(String::from)
            .collect();
        let (data_type, hint) = infer_data_type_with_hint(&values);
        assert!(matches!(data_type, DataType::Currency { code } if code == "USD"));
        assert!(hint.is_some());
        let hint = hint.unwrap();
        assert_eq!(hint.pattern, Some("USD #,##0.00".to_string()));
        assert_eq!(hint.locale, Some("en-US".to_string()));
    }

    #[test]
    fn test_sample_values_small_dataset() {
        let values: Vec<&str> = (0..50).map(|_| "test").collect();
        let sampled = sample_values(&values);
        assert_eq!(sampled.len(), 50);
    }

    #[test]
    fn test_sample_values_large_dataset() {
        let values: Vec<&str> = (0..1000).map(|_| "test").collect();
        let sampled = sample_values(&values);
        assert_eq!(sampled.len(), TYPE_INFERENCE_SAMPLE_SIZE);
    }

    #[test]
    fn test_threshold_detection() {
        // 90% threshold should work
        assert!(meets_threshold(90, 100));
        assert!(meets_threshold(95, 100));
        assert!(!meets_threshold(89, 100));
    }

    // ========================================================================
    // Semantic Role Inference Tests
    // ========================================================================

    #[test]
    fn test_infer_semantic_role_customer_id() {
        // Testing criteria: customer_id detected as Identifier
        let role = infer_semantic_role("customer_id", &DataType::Integer);
        assert!(matches!(role, SemanticRole::Identifier));
    }

    #[test]
    fn test_infer_semantic_role_created_at() {
        // Testing criteria: created_at detected as Temporal
        let role = infer_semantic_role("created_at", &DataType::Text);
        assert!(matches!(role, SemanticRole::Temporal));
    }

    #[test]
    fn test_infer_semantic_role_total_amount() {
        // Testing criteria: total_amount detected as Measure
        let role = infer_semantic_role("total_amount", &DataType::Decimal { precision: Some(2) });
        assert!(matches!(role, SemanticRole::Measure));
    }

    #[test]
    fn test_infer_semantic_role_product_category() {
        // Testing criteria: product_category detected as Dimension
        let role = infer_semantic_role("product_category", &DataType::Text);
        assert!(matches!(role, SemanticRole::Dimension));
    }

    #[test]
    fn test_infer_semantic_role_identifier_variations() {
        // Test various identifier patterns
        assert!(matches!(
            infer_semantic_role("id", &DataType::Integer),
            SemanticRole::Identifier
        ));
        assert!(matches!(
            infer_semantic_role("user_id", &DataType::Integer),
            SemanticRole::Identifier
        ));
        assert!(matches!(
            infer_semantic_role("order_key", &DataType::Text),
            SemanticRole::Identifier
        ));
        assert!(matches!(
            infer_semantic_role("uuid", &DataType::Text),
            SemanticRole::Identifier
        ));
        assert!(matches!(
            infer_semantic_role("product_uuid", &DataType::Text),
            SemanticRole::Identifier
        ));
        assert!(matches!(
            infer_semantic_role("sku_code", &DataType::Text),
            SemanticRole::Identifier
        ));
        assert!(matches!(
            infer_semantic_role("userid", &DataType::Integer),
            SemanticRole::Identifier
        ));
    }

    #[test]
    fn test_infer_semantic_role_identifier_false_positives() {
        // These should NOT be detected as identifiers
        assert!(!matches!(
            infer_semantic_role("paid", &DataType::Boolean),
            SemanticRole::Identifier
        ));
        assert!(!matches!(
            infer_semantic_role("valid", &DataType::Boolean),
            SemanticRole::Identifier
        ));
    }

    #[test]
    fn test_infer_semantic_role_temporal_variations() {
        // Test various temporal patterns
        assert!(matches!(
            infer_semantic_role("updated_at", &DataType::Text),
            SemanticRole::Temporal
        ));
        assert!(matches!(
            infer_semantic_role(
                "birth_date",
                &DataType::Date {
                    format: "YYYY-MM-DD".to_string()
                }
            ),
            SemanticRole::Temporal
        ));
        assert!(matches!(
            infer_semantic_role("start_time", &DataType::Text),
            SemanticRole::Temporal
        ));
        assert!(matches!(
            infer_semantic_role("created_datetime", &DataType::Text),
            SemanticRole::Temporal
        ));
        assert!(matches!(
            infer_semantic_role("event_timestamp", &DataType::Text),
            SemanticRole::Temporal
        ));
        assert!(matches!(
            infer_semantic_role("order_date", &DataType::Text),
            SemanticRole::Temporal
        ));
    }

    #[test]
    fn test_infer_semantic_role_measure_variations() {
        // Test various measure patterns
        assert!(matches!(
            infer_semantic_role("price", &DataType::Decimal { precision: Some(2) }),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role(
                "unit_price",
                &DataType::Currency {
                    code: "USD".to_string()
                }
            ),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role("total_revenue", &DataType::Decimal { precision: Some(2) }),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role("item_count", &DataType::Integer),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role(
                "order_total",
                &DataType::Currency {
                    code: "USD".to_string()
                }
            ),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role("shipping_cost", &DataType::Decimal { precision: Some(2) }),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role("qty", &DataType::Integer),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role("quantity", &DataType::Integer),
            SemanticRole::Measure
        ));
    }

    #[test]
    fn test_infer_semantic_role_dimension_variations() {
        // Test various dimension patterns
        assert!(matches!(
            infer_semantic_role("customer_type", &DataType::Text),
            SemanticRole::Dimension
        ));
        assert!(matches!(
            infer_semantic_role("region", &DataType::Text),
            SemanticRole::Dimension
        ));
        assert!(matches!(
            infer_semantic_role("order_status", &DataType::Enum { values: vec![] }),
            SemanticRole::Dimension
        ));
        assert!(matches!(
            infer_semantic_role("country", &DataType::Text),
            SemanticRole::Dimension
        ));
        assert!(matches!(
            infer_semantic_role("city", &DataType::Text),
            SemanticRole::Dimension
        ));
        assert!(matches!(
            infer_semantic_role("customer_segment", &DataType::Text),
            SemanticRole::Dimension
        ));
        assert!(matches!(
            infer_semantic_role("membership_tier", &DataType::Text),
            SemanticRole::Dimension
        ));
    }

    #[test]
    fn test_infer_semantic_role_descriptive_variations() {
        // Test various descriptive patterns
        assert!(matches!(
            infer_semantic_role("notes", &DataType::Text),
            SemanticRole::Descriptive
        ));
        assert!(matches!(
            infer_semantic_role("order_notes", &DataType::Text),
            SemanticRole::Descriptive
        ));
        assert!(matches!(
            infer_semantic_role("product_description", &DataType::Text),
            SemanticRole::Descriptive
        ));
        assert!(matches!(
            infer_semantic_role("customer_comment", &DataType::Text),
            SemanticRole::Descriptive
        ));
        assert!(matches!(
            infer_semantic_role("internal_memo", &DataType::Text),
            SemanticRole::Descriptive
        ));
        assert!(matches!(
            infer_semantic_role("name", &DataType::Text),
            SemanticRole::Descriptive
        ));
        assert!(matches!(
            infer_semantic_role("product_name", &DataType::Text),
            SemanticRole::Descriptive
        ));
        assert!(matches!(
            infer_semantic_role("customer_name", &DataType::Text),
            SemanticRole::Descriptive
        ));
    }

    #[test]
    fn test_infer_semantic_role_data_type_fallback() {
        // When name doesn't match any pattern, fall back to data type
        assert!(matches!(
            infer_semantic_role(
                "xyz",
                &DataType::Currency {
                    code: "USD".to_string()
                }
            ),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role(
                "foo",
                &DataType::Date {
                    format: "YYYY-MM-DD".to_string()
                }
            ),
            SemanticRole::Temporal
        ));
        assert!(matches!(
            infer_semantic_role(
                "bar",
                &DataType::DateTime {
                    format: "YYYY-MM-DD HH:mm:ss".to_string()
                }
            ),
            SemanticRole::Temporal
        ));
        assert!(matches!(
            infer_semantic_role(
                "baz",
                &DataType::Enum {
                    values: vec!["A".to_string(), "B".to_string()]
                }
            ),
            SemanticRole::Dimension
        ));
        assert!(matches!(
            infer_semantic_role("qux", &DataType::Integer),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role("quux", &DataType::Decimal { precision: Some(2) }),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role("corge", &DataType::Boolean),
            SemanticRole::Dimension
        ));
    }

    #[test]
    fn test_infer_semantic_role_unknown_fallback() {
        // Plain text with no recognizable pattern should be Unknown
        let role = infer_semantic_role("xyz", &DataType::Text);
        assert!(matches!(role, SemanticRole::Unknown));
    }

    #[test]
    fn test_infer_semantic_role_case_insensitive() {
        // Should work regardless of case
        assert!(matches!(
            infer_semantic_role("CUSTOMER_ID", &DataType::Integer),
            SemanticRole::Identifier
        ));
        assert!(matches!(
            infer_semantic_role("Created_At", &DataType::Text),
            SemanticRole::Temporal
        ));
        assert!(matches!(
            infer_semantic_role("TOTAL_AMOUNT", &DataType::Decimal { precision: Some(2) }),
            SemanticRole::Measure
        ));
        assert!(matches!(
            infer_semantic_role("Product_Category", &DataType::Text),
            SemanticRole::Dimension
        ));
    }

    #[test]
    fn test_infer_semantic_role_name_priority_over_data_type() {
        // Name-based detection should take priority over data type fallback
        // Even if data type suggests Measure, if name suggests Identifier, use Identifier
        let role = infer_semantic_role("customer_id", &DataType::Integer);
        assert!(matches!(role, SemanticRole::Identifier));

        // Even if data type is Date, if name doesn't match temporal pattern,
        // temporal patterns in name should still take precedence
        let role = infer_semantic_role("created_at", &DataType::Text);
        assert!(matches!(role, SemanticRole::Temporal));
    }

    // ========================================================================
    // Schema Inference Tests
    // ========================================================================

    #[test]
    fn test_infer_schema_basic() {
        let data = CsvData {
            headers: vec!["id".to_string(), "name".to_string(), "amount".to_string()],
            rows: vec![
                vec!["1".to_string(), "Alice".to_string(), "100.50".to_string()],
                vec!["2".to_string(), "Bob".to_string(), "200.75".to_string()],
                vec!["3".to_string(), "Charlie".to_string(), "150.25".to_string()],
            ],
            total_rows: 3,
            truncated: false,
        };

        let schema = infer_schema("test.csv", &data, None);

        assert_eq!(schema.version, 1);
        assert_eq!(schema.source_file, "test.csv");
        assert_eq!(schema.columns.len(), 3);
        assert!(!schema.read_only);

        // Check id column
        assert_eq!(schema.columns[0].name, "id");
        assert!(matches!(
            schema.columns[0].semantic_role,
            SemanticRole::Identifier
        ));

        // Check name column
        assert_eq!(schema.columns[1].name, "name");
        assert!(matches!(
            schema.columns[1].semantic_role,
            SemanticRole::Descriptive
        ));

        // Check amount column
        assert_eq!(schema.columns[2].name, "amount");
        assert!(matches!(
            schema.columns[2].data_type,
            DataType::Decimal { .. }
        ));
    }

    #[test]
    fn test_infer_schema_preserves_user_descriptions() {
        let data = CsvData {
            headers: vec!["customer_id".to_string(), "total_amount".to_string()],
            rows: vec![
                vec!["1".to_string(), "100.00".to_string()],
                vec!["2".to_string(), "200.00".to_string()],
            ],
            total_rows: 2,
            truncated: false,
        };

        // First inference
        let schema1 = infer_schema("test.csv", &data, None);

        // Simulate user editing the description
        let mut modified_schema = schema1.clone();
        modified_schema.columns[0].description =
            "Custom user description for customer ID".to_string();

        // Re-infer with existing schema
        let schema2 = infer_schema("test.csv", &data, Some(&modified_schema));

        // User description should be preserved
        assert_eq!(
            schema2.columns[0].description,
            "Custom user description for customer ID"
        );

        // Auto-generated description should be regenerated (since it wasn't edited)
        // The second column should have an auto-generated description
        assert!(schema2.columns[1].description.contains("Total Amount"));
    }

    #[test]
    fn test_compute_column_metadata_integers() {
        let values: Vec<String> = vec!["100", "200", "300", "400", "500"]
            .into_iter()
            .map(String::from)
            .collect();

        let metadata = compute_column_metadata(&values, &DataType::Integer);

        assert_eq!(metadata.non_null_count, Some(5));
        assert_eq!(metadata.distinct_count, Some(5));
        assert!(metadata.unique);
        assert!(!metadata.nullable);
        assert!(metadata.numeric_stats.is_some());

        let stats = metadata.numeric_stats.unwrap();
        assert_eq!(stats.min, 100.0);
        assert_eq!(stats.max, 500.0);
        assert_eq!(stats.sum, 1500.0);
        assert_eq!(stats.mean, 300.0);
    }

    #[test]
    fn test_compute_column_metadata_with_nulls() {
        let values: Vec<String> = vec!["100", "", "200", "", "300"]
            .into_iter()
            .map(String::from)
            .collect();

        let metadata = compute_column_metadata(&values, &DataType::Integer);

        assert_eq!(metadata.non_null_count, Some(3));
        assert_eq!(metadata.distinct_count, Some(3));
        assert!(metadata.nullable);
        assert!(metadata.numeric_stats.is_some());

        let stats = metadata.numeric_stats.unwrap();
        assert_eq!(stats.min, 100.0);
        assert_eq!(stats.max, 300.0);
    }

    #[test]
    fn test_compute_column_metadata_currency() {
        let values: Vec<String> = vec!["$50.00", "$100.00", "$150.00"]
            .into_iter()
            .map(String::from)
            .collect();

        let metadata = compute_column_metadata(
            &values,
            &DataType::Currency {
                code: "USD".to_string(),
            },
        );

        assert!(metadata.numeric_stats.is_some());
        let stats = metadata.numeric_stats.unwrap();
        assert_eq!(stats.min, 50.0);
        assert_eq!(stats.max, 150.0);
        assert_eq!(stats.sum, 300.0);
        assert_eq!(stats.mean, 100.0);
    }

    #[test]
    fn test_compute_column_metadata_samples() {
        let values: Vec<String> = vec![
            "apple",
            "banana",
            "cherry",
            "date",
            "elderberry",
            "fig",
            "grape",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let metadata = compute_column_metadata(&values, &DataType::Text);

        // Should only have max 5 samples
        assert!(metadata.examples.len() <= 5);
        assert_eq!(metadata.distinct_count, Some(7));
    }

    #[test]
    fn test_generate_description_identifier() {
        let desc =
            generate_description("customer_id", &DataType::Integer, &SemanticRole::Identifier);
        assert!(desc.contains("Customer Id"));
        assert!(desc.contains("unique identifier"));
    }

    #[test]
    fn test_generate_description_currency() {
        let desc = generate_description(
            "order_total",
            &DataType::Currency {
                code: "USD".to_string(),
            },
            &SemanticRole::Measure,
        );
        assert!(desc.contains("Order Total"));
        assert!(desc.contains("USD"));
    }

    #[test]
    fn test_generate_description_enum() {
        let desc = generate_description(
            "status",
            &DataType::Enum {
                values: vec![
                    "Active".to_string(),
                    "Inactive".to_string(),
                    "Pending".to_string(),
                ],
            },
            &SemanticRole::Dimension,
        );
        assert!(desc.contains("Status"));
        assert!(desc.contains("Active"));
        assert!(desc.contains("Inactive"));
        assert!(desc.contains("Pending"));
    }

    #[test]
    fn test_generate_description_date() {
        let desc = generate_description(
            "created_at",
            &DataType::Date {
                format: "YYYY-MM-DD".to_string(),
            },
            &SemanticRole::Temporal,
        );
        assert!(desc.contains("Created At"));
        assert!(desc.contains("YYYY-MM-DD"));
    }

    #[test]
    fn test_numeric_stats_percentage() {
        let values: Vec<String> = vec!["10%", "20%", "30%", "40%"]
            .into_iter()
            .map(String::from)
            .collect();

        let metadata = compute_column_metadata(&values, &DataType::Percentage);

        assert!(metadata.numeric_stats.is_some());
        let stats = metadata.numeric_stats.unwrap();
        assert_eq!(stats.min, 10.0);
        assert_eq!(stats.max, 40.0);
        assert_eq!(stats.mean, 25.0);
    }

    #[test]
    fn test_infer_schema_with_mixed_types() {
        let data = CsvData {
            headers: vec![
                "order_id".to_string(),
                "customer_name".to_string(),
                "order_date".to_string(),
                "total_amount".to_string(),
                "status".to_string(),
            ],
            rows: vec![
                vec![
                    "1".to_string(),
                    "Alice".to_string(),
                    "2024-01-15".to_string(),
                    "$100.00".to_string(),
                    "Active".to_string(),
                ],
                vec![
                    "2".to_string(),
                    "Bob".to_string(),
                    "2024-01-16".to_string(),
                    "$200.00".to_string(),
                    "Pending".to_string(),
                ],
                vec![
                    "3".to_string(),
                    "Charlie".to_string(),
                    "2024-01-17".to_string(),
                    "$150.00".to_string(),
                    "Active".to_string(),
                ],
            ],
            total_rows: 3,
            truncated: false,
        };

        let schema = infer_schema("orders.csv", &data, None);

        // Verify column count
        assert_eq!(schema.columns.len(), 5);

        // order_id should be Identifier
        assert!(matches!(
            schema.columns[0].semantic_role,
            SemanticRole::Identifier
        ));

        // customer_name should be Descriptive
        assert!(matches!(
            schema.columns[1].semantic_role,
            SemanticRole::Descriptive
        ));

        // order_date should be Temporal
        assert!(matches!(
            schema.columns[2].semantic_role,
            SemanticRole::Temporal
        ));
        assert!(matches!(schema.columns[2].data_type, DataType::Date { .. }));

        // total_amount should be Measure with Currency type
        assert!(matches!(
            schema.columns[3].semantic_role,
            SemanticRole::Measure
        ));
        assert!(matches!(
            schema.columns[3].data_type,
            DataType::Currency { .. }
        ));

        // status should have numeric stats for currency column
        assert!(schema.columns[3].metadata.numeric_stats.is_some());
    }

    // ========================================================================
    // AI Context Generation Tests
    // ========================================================================

    #[test]
    fn test_generate_ai_context_basic() {
        let data = CsvData {
            headers: vec!["id".to_string(), "name".to_string(), "amount".to_string()],
            rows: vec![
                vec!["1".to_string(), "Alice".to_string(), "100.50".to_string()],
                vec!["2".to_string(), "Bob".to_string(), "200.75".to_string()],
            ],
            total_rows: 2,
            truncated: false,
        };

        let schema = infer_schema("test.csv", &data, None);
        let context = generate_ai_context("test.csv", &schema, &data, None);

        assert_eq!(context.file_path, "test.csv");
        assert_eq!(context.columns.len(), 3);
        assert!(!context.schema_summary.is_empty());
        assert!(!context.sample_data.is_empty());
    }

    #[test]
    fn test_generate_ai_context_markdown_table() {
        let data = CsvData {
            headers: vec!["col1".to_string(), "col2".to_string()],
            rows: vec![
                vec!["a".to_string(), "b".to_string()],
                vec!["c".to_string(), "d".to_string()],
            ],
            total_rows: 2,
            truncated: false,
        };

        let markdown = generate_sample_data_markdown(&data, 10);

        // Check that markdown contains table elements
        assert!(markdown.contains("| col1 | col2 |"));
        assert!(markdown.contains("| --- | --- |"));
        assert!(markdown.contains("| a | b |"));
        assert!(markdown.contains("| c | d |"));
    }

    #[test]
    fn test_generate_ai_context_markdown_table_truncation() {
        let data = CsvData {
            headers: vec!["id".to_string()],
            rows: vec![
                vec!["1".to_string()],
                vec!["2".to_string()],
                vec!["3".to_string()],
                vec!["4".to_string()],
                vec!["5".to_string()],
            ],
            total_rows: 5,
            truncated: false,
        };

        let markdown = generate_sample_data_markdown(&data, 2);

        // Should show only 2 rows
        assert!(markdown.contains("| 1 |"));
        assert!(markdown.contains("| 2 |"));
        assert!(!markdown.contains("| 3 |"));
        // Should show truncation notice
        assert!(markdown.contains("Showing 2 of 5 rows"));
    }

    #[test]
    fn test_generate_ai_context_markdown_escapes_pipes() {
        let data = CsvData {
            headers: vec!["value".to_string()],
            rows: vec![vec!["a|b|c".to_string()]],
            total_rows: 1,
            truncated: false,
        };

        let markdown = generate_sample_data_markdown(&data, 10);

        // Pipes should be escaped
        assert!(markdown.contains(r"a\|b\|c"));
    }

    #[test]
    fn test_generate_ai_context_markdown_truncates_long_values() {
        let data = CsvData {
            headers: vec!["long_text".to_string()],
            rows: vec![vec!["a".repeat(100)]], // 100 character string
            total_rows: 1,
            truncated: false,
        };

        let markdown = generate_sample_data_markdown(&data, 10);

        // Long values should be truncated with ellipsis
        assert!(markdown.contains("..."));
        // Should not contain the full 100 character string
        assert!(!markdown.contains(&"a".repeat(100)));
    }

    #[test]
    fn test_data_type_to_string() {
        assert_eq!(data_type_to_string(&DataType::Text), "text");
        assert_eq!(data_type_to_string(&DataType::Integer), "integer");
        assert_eq!(data_type_to_string(&DataType::Boolean), "boolean");
        assert_eq!(data_type_to_string(&DataType::Percentage), "percentage");

        assert_eq!(
            data_type_to_string(&DataType::Decimal { precision: Some(2) }),
            "decimal (precision: 2)"
        );
        assert_eq!(
            data_type_to_string(&DataType::Decimal { precision: None }),
            "decimal"
        );

        assert_eq!(
            data_type_to_string(&DataType::Currency {
                code: "USD".to_string()
            }),
            "currency (USD)"
        );

        assert_eq!(
            data_type_to_string(&DataType::Date {
                format: "YYYY-MM-DD".to_string()
            }),
            "date (format: YYYY-MM-DD)"
        );

        assert_eq!(
            data_type_to_string(&DataType::DateTime {
                format: "YYYY-MM-DD HH:mm:ss".to_string()
            }),
            "datetime (format: YYYY-MM-DD HH:mm:ss)"
        );

        // Enum with few values shows them all
        assert_eq!(
            data_type_to_string(&DataType::Enum {
                values: vec!["A".to_string(), "B".to_string()]
            }),
            "enum [A, B]"
        );

        // Enum with many values shows count
        assert_eq!(
            data_type_to_string(&DataType::Enum {
                values: vec![
                    "A".to_string(),
                    "B".to_string(),
                    "C".to_string(),
                    "D".to_string(),
                    "E".to_string(),
                    "F".to_string()
                ]
            }),
            "enum (6 values)"
        );
    }

    #[test]
    fn test_semantic_role_to_string() {
        assert_eq!(
            semantic_role_to_string(&SemanticRole::Identifier),
            "identifier"
        );
        assert_eq!(
            semantic_role_to_string(&SemanticRole::Dimension),
            "dimension"
        );
        assert_eq!(semantic_role_to_string(&SemanticRole::Measure), "measure");
        assert_eq!(semantic_role_to_string(&SemanticRole::Temporal), "temporal");
        assert_eq!(
            semantic_role_to_string(&SemanticRole::Descriptive),
            "descriptive"
        );
        assert_eq!(semantic_role_to_string(&SemanticRole::Unknown), "unknown");
        assert_eq!(
            semantic_role_to_string(&SemanticRole::Reference {
                target_file: "other.csv".to_string(),
                target_column: "id".to_string(),
            }),
            "reference"
        );
    }

    #[test]
    fn test_cardinality_to_string() {
        assert_eq!(cardinality_to_string(&Cardinality::OneToOne), "one-to-one");
        assert_eq!(
            cardinality_to_string(&Cardinality::OneToMany),
            "one-to-many"
        );
        assert_eq!(
            cardinality_to_string(&Cardinality::ManyToOne),
            "many-to-one"
        );
        assert_eq!(
            cardinality_to_string(&Cardinality::ManyToMany),
            "many-to-many"
        );
    }

    #[test]
    fn test_column_to_ai_context() {
        let column = ColumnSchema {
            name: "customer_id".to_string(),
            display_name: Some("Customer ID".to_string()),
            description: "Unique customer identifier".to_string(),
            data_type: DataType::Integer,
            semantic_role: SemanticRole::Identifier,
            format: None,
            metadata: ColumnMetadata {
                nullable: false,
                unique: true,
                examples: vec!["1".to_string(), "2".to_string(), "3".to_string()],
                min_value: Some("1".to_string()),
                max_value: Some("100".to_string()),
                distinct_count: Some(100),
                non_null_count: Some(100),
                numeric_stats: None,
            },
        };

        let context = column_to_ai_context(&column);

        assert_eq!(context.name, "Customer ID"); // Uses display_name
        assert_eq!(context.data_type, "integer");
        assert_eq!(context.role, "identifier");
        assert_eq!(context.description, "Unique customer identifier");
        assert_eq!(context.examples, vec!["1", "2", "3"]);
    }

    #[test]
    fn test_column_to_ai_context_no_display_name() {
        let column = ColumnSchema {
            name: "customer_id".to_string(),
            display_name: None,
            description: "Unique customer identifier".to_string(),
            data_type: DataType::Integer,
            semantic_role: SemanticRole::Identifier,
            format: None,
            metadata: ColumnMetadata::default(),
        };

        let context = column_to_ai_context(&column);

        assert_eq!(context.name, "customer_id"); // Falls back to name
    }

    #[test]
    fn test_relationship_to_ai_context() {
        let relationship = Relationship {
            name: "Order Customer".to_string(),
            local_column: "customer_id".to_string(),
            foreign_file: "customers.csv".to_string(),
            foreign_column: "id".to_string(),
            cardinality: Cardinality::ManyToOne,
        };

        let context = relationship_to_ai_context(&relationship);

        assert_eq!(context.local_column, "customer_id");
        assert_eq!(context.foreign_reference, "customers.csv.id");
        assert!(context.description.contains("Order Customer"));
        assert!(context.description.contains("many-to-one"));
    }

    #[test]
    fn test_generate_schema_summary() {
        let data = CsvData {
            headers: vec!["id".to_string(), "name".to_string(), "amount".to_string()],
            rows: vec![vec![
                "1".to_string(),
                "Alice".to_string(),
                "100".to_string(),
            ]],
            total_rows: 100,
            truncated: true,
        };

        let schema = infer_schema("/path/to/orders.csv", &data, None);
        let summary = generate_schema_summary("/path/to/orders.csv", &data, &schema);

        assert!(summary.contains("orders.csv"));
        assert!(summary.contains("100 rows"));
        assert!(summary.contains("3 columns"));
    }

    #[test]
    fn test_generate_ai_context_with_relationships() {
        let data = CsvData {
            headers: vec!["order_id".to_string(), "customer_id".to_string()],
            rows: vec![vec!["1".to_string(), "100".to_string()]],
            total_rows: 1,
            truncated: false,
        };

        let mut schema = infer_schema("orders.csv", &data, None);
        schema.relationships = vec![Relationship {
            name: "Order Customer".to_string(),
            local_column: "customer_id".to_string(),
            foreign_file: "customers.csv".to_string(),
            foreign_column: "id".to_string(),
            cardinality: Cardinality::ManyToOne,
        }];

        let context = generate_ai_context("orders.csv", &schema, &data, None);

        assert_eq!(context.relationships.len(), 1);
        assert_eq!(context.relationships[0].local_column, "customer_id");
        assert_eq!(
            context.relationships[0].foreign_reference,
            "customers.csv.id"
        );
    }

    #[test]
    fn test_generate_ai_context_column_descriptions_included() {
        let data = CsvData {
            headers: vec!["customer_id".to_string(), "total_amount".to_string()],
            rows: vec![
                vec!["1".to_string(), "$100.00".to_string()],
                vec!["2".to_string(), "$200.00".to_string()],
            ],
            total_rows: 2,
            truncated: false,
        };

        let schema = infer_schema("orders.csv", &data, None);
        let context = generate_ai_context("orders.csv", &schema, &data, None);

        // Verify column descriptions are present
        assert!(!context.columns[0].description.is_empty());
        assert!(!context.columns[1].description.is_empty());

        // Descriptions should be meaningful
        assert!(context.columns[0].description.contains("Customer Id"));
        assert!(context.columns[1].description.contains("Total Amount"));
    }

    #[test]
    fn test_generate_ai_context_empty_data() {
        let data = CsvData {
            headers: vec!["col1".to_string()],
            rows: vec![],
            total_rows: 0,
            truncated: false,
        };

        let schema = infer_schema("empty.csv", &data, None);
        let context = generate_ai_context("empty.csv", &schema, &data, None);

        // Should still work with empty data
        assert_eq!(context.file_path, "empty.csv");
        assert_eq!(context.columns.len(), 1);
        assert!(context.schema_summary.contains("0 rows"));
    }

    #[tokio::test]
    #[ignore = "TODO: compute_hash function not yet implemented"]
    async fn test_compute_hash_file_not_found() {
        // let result = compute_hash(std::path::Path::new("/nonexistent/file.csv")).await;
        // assert!(result.is_err());
        // match result {
        //     Err(CsvError::ReadError { message }) => {
        //         assert!(message.contains("Failed to read file for hashing"));
        //     }
        //     _ => panic!("Expected ReadError"),
        // }
    }

    // ========================================================================
    // Single Column CSV Tests
    // ========================================================================

    #[test]
    fn test_parse_single_column_csv() {
        let content = "name\nAlice\nBob\nCharlie";
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.headers.len(), 1);
        assert_eq!(result.headers[0], "name");
        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.rows[0], vec!["Alice"]);
        assert_eq!(result.rows[1], vec!["Bob"]);
        assert_eq!(result.rows[2], vec!["Charlie"]);
    }

    #[test]
    fn test_parse_single_column_numeric() {
        let content = "value\n100\n200\n300";
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.headers.len(), 1);
        assert_eq!(result.headers[0], "value");
        assert_eq!(result.rows.len(), 3);
    }

    #[test]
    fn test_infer_schema_single_column() {
        let data = CsvData {
            headers: vec!["amount".to_string()],
            rows: vec![
                vec!["100.50".to_string()],
                vec!["200.75".to_string()],
                vec!["150.25".to_string()],
            ],
            total_rows: 3,
            truncated: false,
        };

        let schema = infer_schema("single.csv", &data, None);

        assert_eq!(schema.columns.len(), 1);
        assert_eq!(schema.columns[0].name, "amount");
        assert!(matches!(
            schema.columns[0].data_type,
            DataType::Decimal { .. }
        ));
        assert!(matches!(
            schema.columns[0].semantic_role,
            SemanticRole::Measure
        ));
    }

    #[test]
    fn test_single_column_with_empty_values() {
        let data = CsvData {
            headers: vec!["status".to_string()],
            rows: vec![
                vec!["Active".to_string()],
                vec!["".to_string()],
                vec!["Inactive".to_string()],
                vec!["".to_string()],
                vec!["Active".to_string()],
            ],
            total_rows: 5,
            truncated: false,
        };

        let schema = infer_schema("status.csv", &data, None);

        assert_eq!(schema.columns.len(), 1);
        assert!(schema.columns[0].metadata.nullable);
        assert_eq!(schema.columns[0].metadata.non_null_count, Some(3));
    }

    // ========================================================================
    // Additional Boolean Detection Tests
    // ========================================================================

    #[test]
    fn test_infer_boolean_on_off() {
        let values: Vec<String> = vec![
            "on", "off", "on", "off", "on", "off", "on", "off", "on", "off",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Boolean));
    }

    #[test]
    fn test_infer_boolean_t_f() {
        let values: Vec<String> = vec!["t", "f", "T", "F", "t", "f", "T", "F", "t", "f"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Boolean));
    }

    #[test]
    fn test_infer_boolean_y_n() {
        let values: Vec<String> = vec!["y", "n", "Y", "N", "y", "n", "Y", "N", "y", "n"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Boolean));
    }

    #[test]
    fn test_infer_boolean_mixed_formats() {
        // Test mixed boolean representations that should still be detected
        let values: Vec<String> = vec![
            "true", "FALSE", "Yes", "no", "1", "0", "ON", "off", "T", "f",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Boolean));
    }

    // ========================================================================
    // Additional Edge Case Tests
    // ========================================================================

    #[test]
    fn test_parse_csv_only_header_with_commas() {
        // Edge case: header with quoted commas, no data rows
        let content = r#""Name, Full","Address, Complete""#;
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.headers.len(), 2);
        assert_eq!(result.headers[0], "Name, Full");
        assert_eq!(result.headers[1], "Address, Complete");
        assert_eq!(result.rows.len(), 0);
    }

    #[test]
    fn test_infer_all_empty_column() {
        // Column where every value is empty/whitespace
        let values: Vec<String> = vec!["", "  ", "\t", ""]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Text));
    }

    #[test]
    fn test_column_metadata_all_unique() {
        let values: Vec<String> = vec!["a", "b", "c", "d", "e"]
            .into_iter()
            .map(String::from)
            .collect();
        let metadata = compute_column_metadata(&values, &DataType::Text);
        assert!(metadata.unique);
        assert_eq!(metadata.distinct_count, Some(5));
    }

    #[test]
    fn test_column_metadata_with_duplicates() {
        let values: Vec<String> = vec!["a", "a", "b", "b", "c"]
            .into_iter()
            .map(String::from)
            .collect();
        let metadata = compute_column_metadata(&values, &DataType::Text);
        assert!(!metadata.unique);
        assert_eq!(metadata.distinct_count, Some(3));
    }

    #[test]
    fn test_infer_percentage_with_decimals() {
        let values: Vec<String> = vec!["10.5%", "25.75%", "100.00%", "-5.25%"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Percentage));
    }

    #[test]
    fn test_infer_negative_percentage() {
        let values: Vec<String> = vec!["-10%", "-25%", "-50%", "-100%"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Percentage));
    }

    #[test]
    fn test_infer_datetime_with_timezone() {
        let values: Vec<String> = vec![
            "2024-01-15T10:30:00Z",
            "2024-02-20T14:45:30Z",
            "2023-12-31T23:59:59Z",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::DateTime { .. }));
    }

    #[test]
    fn test_infer_datetime_with_offset() {
        let values: Vec<String> = vec![
            "2024-01-15T10:30:00+05:00",
            "2024-02-20T14:45:30-08:00",
            "2023-12-31T23:59:59+00:00",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::DateTime { .. }));
    }

    #[test]
    fn test_infer_decimal_with_commas() {
        let values: Vec<String> = vec!["1,234.56", "2,500.00", "10,000.99"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Decimal { .. }));
    }

    #[test]
    fn test_infer_currency_negative_values() {
        // Test that the system handles negative currency format without panicking
        // The $-amount format is detected as currency
        let values: Vec<String> = vec!["$-100.00", "$-50.25", "$-1,000.00"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        // $-amount format should be detected as USD currency
        assert!(matches!(result, DataType::Currency { code } if code == "USD"));
    }

    #[test]
    fn test_generate_ai_context_single_column() {
        let data = CsvData {
            headers: vec!["id".to_string()],
            rows: vec![vec!["1".to_string()], vec!["2".to_string()]],
            total_rows: 2,
            truncated: false,
        };

        let schema = infer_schema("single.csv", &data, None);
        let context = generate_ai_context("single.csv", &schema, &data, None);

        assert_eq!(context.columns.len(), 1);
        assert!(!context.sample_data.is_empty());
    }

    #[test]
    fn test_parse_csv_with_newlines_in_quoted_fields() {
        let content = "name,description\n\"Alice\",\"Line 1\nLine 2\"\n\"Bob\",\"Single line\"";
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0][1], "Line 1\nLine 2");
        assert_eq!(result.rows[1][1], "Single line");
    }

    #[test]
    fn test_parse_csv_with_escaped_quotes() {
        let content = "name,quote\n\"Alice\",\"He said \"\"Hello\"\"\"\n\"Bob\",\"Simple\"";
        let result = parse_csv_content(content, None).unwrap();

        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0][1], "He said \"Hello\"");
    }

    #[test]
    fn test_infer_single_value_column() {
        // Column with only one unique value - should not be enum
        let values: Vec<String> = vec!["constant", "constant", "constant"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        // Single unique value doesn't qualify as enum (needs > 1 unique values)
        assert!(matches!(result, DataType::Text));
    }

    #[test]
    fn test_disambiguate_date_format_us() {
        // When second component > 12, it must be day (MM/DD/YYYY)
        let values: Vec<String> = vec!["01/25/2024", "02/28/2024", "12/15/2023"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Date { format } if format == "MM/DD/YYYY"));
    }

    #[test]
    fn test_infer_date_yyyy_slash_mm_dd() {
        let values: Vec<String> = vec!["2024/01/15", "2024/02/20", "2023/12/31"]
            .into_iter()
            .map(String::from)
            .collect();
        let result = infer_data_type(&values);
        assert!(matches!(result, DataType::Date { format } if format == "YYYY/MM/DD"));
    }

    // ========================================================================
    // Schema Preservation Tests
    // ========================================================================

    #[test]
    fn test_infer_schema_preserves_display_names() {
        let data = CsvData {
            headers: vec!["customer_id".to_string()],
            rows: vec![vec!["1".to_string()]],
            total_rows: 1,
            truncated: false,
        };

        // First inference
        let schema1 = infer_schema("test.csv", &data, None);

        // Simulate user setting display name
        let mut modified_schema = schema1.clone();
        modified_schema.columns[0].display_name = Some("Customer Identifier".to_string());

        // Re-infer with existing schema
        let schema2 = infer_schema("test.csv", &data, Some(&modified_schema));

        // Display name should be preserved
        assert_eq!(
            schema2.columns[0].display_name,
            Some("Customer Identifier".to_string())
        );
    }

    #[test]
    fn test_infer_schema_preserves_relationships() {
        let data = CsvData {
            headers: vec!["order_id".to_string(), "customer_id".to_string()],
            rows: vec![vec!["1".to_string(), "100".to_string()]],
            total_rows: 1,
            truncated: false,
        };

        // First inference
        let mut schema1 = infer_schema("orders.csv", &data, None);

        // Add a relationship
        schema1.relationships = vec![Relationship {
            name: "Order Customer".to_string(),
            local_column: "customer_id".to_string(),
            foreign_file: "customers.csv".to_string(),
            foreign_column: "id".to_string(),
            cardinality: Cardinality::ManyToOne,
        }];

        // Re-infer with existing schema
        let schema2 = infer_schema("orders.csv", &data, Some(&schema1));

        // Relationships should be preserved
        assert_eq!(schema2.relationships.len(), 1);
        assert_eq!(schema2.relationships[0].name, "Order Customer");
    }

    #[test]
    fn test_infer_schema_preserves_metadata() {
        let data = CsvData {
            headers: vec!["id".to_string()],
            rows: vec![vec!["1".to_string()]],
            total_rows: 1,
            truncated: false,
        };

        // First inference
        let mut schema1 = infer_schema("test.csv", &data, None);

        // Modify metadata
        schema1.metadata.description = "Custom description".to_string();
        schema1.metadata.tags = vec!["important".to_string(), "production".to_string()];

        // Re-infer with existing schema
        let schema2 = infer_schema("test.csv", &data, Some(&schema1));

        // Metadata should be preserved
        assert_eq!(schema2.metadata.description, "Custom description");
        assert_eq!(schema2.metadata.tags.len(), 2);
    }
}
