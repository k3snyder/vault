//! Core type definitions for CSV Editor Pro
//!
//! Contains all data types for CSV parsing, schema representation,
//! and AI context generation. All types include Specta derives for
//! automatic TypeScript generation.

use serde::{Deserialize, Serialize};
use specta::Type;
use thiserror::Error;

// ============================================================================
// Constants
// ============================================================================

/// Row limit for free users (10,000 rows)
pub const FREE_ROW_LIMIT: usize = 10_000;

// ============================================================================
// Core Data Types
// ============================================================================

/// A single row of CSV data represented as a vector of string values
pub type CsvRow = Vec<String>;

/// CSV data returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvData {
    /// Column headers from the CSV file
    pub headers: Vec<String>,
    /// Data rows (each row is a vector of cell values)
    pub rows: Vec<CsvRow>,
    /// Total number of rows in the file (may exceed rows.len() if truncated)
    pub total_rows: usize,
    /// Whether the data was truncated due to row limits
    pub truncated: bool,
}

// ============================================================================
// Schema Types
// ============================================================================

/// Schema stored in companion .vault.json file
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvSchema {
    /// Schema version for migrations
    pub version: u32,
    /// Path to the source CSV file
    pub source_file: String,
    /// SHA256 hash for change detection
    pub content_hash: String,
    /// ISO timestamp of last update
    pub updated_at: String,
    /// Column definitions
    pub columns: Vec<ColumnSchema>,
    /// Cross-file relationships
    pub relationships: Vec<Relationship>,
    /// Dataset-level metadata
    pub metadata: DatasetMetadata,
    /// True if premium expired (schema becomes read-only)
    pub read_only: bool,
}

/// Individual column schema definition
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSchema {
    /// Original column name from CSV header
    pub name: String,
    /// User-friendly display name (optional override)
    pub display_name: Option<String>,
    /// Description for AI context
    pub description: String,
    /// Inferred or user-specified data type
    pub data_type: DataType,
    /// Semantic role for AI understanding
    pub semantic_role: SemanticRole,
    /// Format hints for display/parsing
    pub format: Option<FormatHint>,
    /// Additional column metadata
    pub metadata: ColumnMetadata,
}

/// Column data type (tagged enum for TypeScript discrimination)
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DataType {
    /// Plain text values
    Text,
    /// Integer numbers
    Integer,
    /// Decimal numbers with optional precision
    Decimal { precision: Option<u8> },
    /// Currency values with ISO currency code
    Currency { code: String },
    /// Date values with format string
    Date { format: String },
    /// DateTime values with format string
    DateTime { format: String },
    /// Boolean true/false values
    Boolean,
    /// Percentage values (0-100 or 0-1)
    Percentage,
    /// Enumerated values with known options
    Enum { values: Vec<String> },
}

/// Semantic role for AI understanding of column purpose
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "role", rename_all = "camelCase")]
pub enum SemanticRole {
    /// Primary key or unique identifier (customer_id, uuid)
    Identifier,
    /// Grouping/categorical field (region, category)
    Dimension,
    /// Numeric field for aggregation (revenue, count)
    Measure,
    /// Date/time field
    Temporal,
    /// Foreign key reference to another file
    #[serde(rename_all = "camelCase")]
    Reference {
        target_file: String,
        target_column: String,
    },
    /// Text notes or comments
    Descriptive,
    /// Role not determined
    Unknown,
}

/// Format hints for display and parsing
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FormatHint {
    /// Display format pattern (e.g., "YYYY-MM-DD", "$#,##0.00")
    pub pattern: Option<String>,
    /// Locale for formatting (e.g., "en-US")
    pub locale: Option<String>,
    /// Timezone for date/time values
    pub timezone: Option<String>,
}

/// Additional metadata for a column
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMetadata {
    /// Whether values can be null/empty
    pub nullable: bool,
    /// Whether values must be unique
    pub unique: bool,
    /// Example values from the data
    pub examples: Vec<String>,
    /// Minimum value (for numeric types)
    pub min_value: Option<String>,
    /// Maximum value (for numeric types)
    pub max_value: Option<String>,
    /// Count of distinct values
    pub distinct_count: Option<usize>,
    /// Count of non-null (non-empty) values
    pub non_null_count: Option<usize>,
    /// Statistics for numeric columns
    pub numeric_stats: Option<NumericStats>,
}

/// Statistics for numeric columns
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NumericStats {
    /// Minimum numeric value
    pub min: f64,
    /// Maximum numeric value
    pub max: f64,
    /// Mean (average) value
    pub mean: f64,
    /// Sum of all values
    pub sum: f64,
}

/// Dataset-level metadata
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DatasetMetadata {
    /// Human-readable description of the dataset
    pub description: String,
    /// Tags for categorization
    pub tags: Vec<String>,
    /// Source of the data (e.g., "CRM export", "Survey results")
    pub source: Option<String>,
    /// Data owner or responsible party
    pub owner: Option<String>,
    /// Notes about data quality or limitations
    pub notes: Option<String>,
}

// ============================================================================
// Relationship Types
// ============================================================================

/// Cross-file relationship definition
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Relationship {
    /// Human-readable name for the relationship
    pub name: String,
    /// Column in this file that references another
    pub local_column: String,
    /// Path to the foreign file
    pub foreign_file: String,
    /// Column in the foreign file
    pub foreign_column: String,
    /// Type of relationship
    pub cardinality: Cardinality,
}

/// Relationship cardinality types
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Cardinality {
    /// One-to-one relationship
    OneToOne,
    /// One-to-many relationship
    OneToMany,
    /// Many-to-one relationship
    ManyToOne,
    /// Many-to-many relationship
    ManyToMany,
}

// ============================================================================
// Error Types
// ============================================================================

/// Typed error enum for CSV operations
#[derive(Debug, Error, Serialize, Deserialize, Type, Clone)]
#[serde(tag = "code", content = "details", rename_all = "camelCase")]
pub enum CsvError {
    /// No vault is currently selected
    #[error("No vault selected")]
    NoVaultSelected,

    /// Path is outside the vault boundary (security violation)
    #[error("Path outside vault boundary: {path}")]
    PathViolation { path: String },

    /// Failed to read the CSV file
    #[error("Failed to read CSV: {message}")]
    ReadError { message: String },

    /// Failed to write the CSV file
    #[error("Failed to write CSV: {message}")]
    WriteError { message: String },

    /// Failed to parse CSV content
    #[error("Failed to parse CSV: {message}")]
    ParseError { message: String },

    /// Premium license required for the requested feature
    #[error("Premium required for {feature}")]
    PremiumRequired { feature: String },

    /// Schema file not found for the CSV
    #[error("Schema not found for {path}")]
    SchemaNotFound { path: String },

    /// Failed to parse the schema file
    #[error("Failed to parse schema: {message}")]
    SchemaParseError { message: String },

    /// State lock was poisoned (internal error)
    #[error("State lock poisoned")]
    LockPoisoned,
}

// ============================================================================
// File Info Types
// ============================================================================

/// Information about a CSV file in the vault
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvFileInfo {
    /// Relative path to the CSV file within the vault
    pub path: String,
    /// File name (without directory path)
    pub name: String,
    /// File size in bytes
    pub size: u64,
    /// Last modified timestamp (ISO 8601 format)
    pub modified_at: String,
    /// Whether the file has an associated .vault.json schema
    pub has_schema: bool,
}

/// Statistics about CSV files in the vault
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvStatistics {
    /// Total number of CSV files in the vault
    pub total_files: usize,
    /// Number of files that have associated schemas
    pub files_with_schemas: usize,
    /// Total rows across all files (premium only, null for free users)
    pub total_rows: Option<usize>,
    /// Path to the largest CSV file (premium only, null for free users)
    pub largest_file: Option<String>,
}

// ============================================================================
// AI Context Types
// ============================================================================

/// AI-optimized context format for LLM consumption
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvAiContext {
    /// Path to the CSV file
    pub file_path: String,
    /// Human-readable description
    pub description: String,
    /// Summary of the schema
    pub schema_summary: String,
    /// Column context for AI
    pub columns: Vec<ColumnAiContext>,
    /// Sample data as markdown table
    pub sample_data: String,
    /// Relationship context for AI
    pub relationships: Vec<RelationshipAiContext>,
}

/// Column information optimized for AI context
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnAiContext {
    /// Column name
    pub name: String,
    /// Data type description
    pub data_type: String,
    /// Semantic role description
    pub role: String,
    /// Column description
    pub description: String,
    /// Example values
    pub examples: Vec<String>,
}

/// Relationship information for AI context
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipAiContext {
    /// Relationship description
    pub description: String,
    /// Local column involved
    pub local_column: String,
    /// Foreign file and column
    pub foreign_reference: String,
}

// ============================================================================
// Event Types
// ============================================================================

/// File change event for external modifications
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// Path to the changed file
    pub path: String,
    /// Type of change
    pub change_type: FileChangeType,
    /// New content hash (if file still exists)
    pub new_hash: Option<String>,
}

/// Types of file changes
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum FileChangeType {
    /// File content was modified
    Modified,
    /// File was deleted
    Deleted,
    /// File was renamed
    Renamed,
}

/// Progress event for large file loading
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvLoadProgress {
    /// Number of rows parsed so far
    pub rows_parsed: usize,
    /// Estimated total rows (if known)
    pub estimated_total: Option<usize>,
    /// Current loading phase
    pub phase: LoadPhase,
}

/// Phases of CSV loading
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum LoadPhase {
    /// Parsing CSV content
    Parsing,
    /// Inferring schema from data
    InferringSchema,
    /// Loading complete
    Complete,
}

// ============================================================================
// Default Implementations
// ============================================================================

impl Default for ColumnMetadata {
    fn default() -> Self {
        Self {
            nullable: true,
            unique: false,
            examples: Vec::new(),
            min_value: None,
            max_value: None,
            distinct_count: None,
            non_null_count: None,
            numeric_stats: None,
        }
    }
}

impl Default for DatasetMetadata {
    fn default() -> Self {
        Self {
            description: String::new(),
            tags: Vec::new(),
            source: None,
            owner: None,
            notes: None,
        }
    }
}

impl Default for FormatHint {
    fn default() -> Self {
        Self {
            pattern: None,
            locale: None,
            timezone: None,
        }
    }
}
