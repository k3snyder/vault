// Plugin Validator - Comprehensive validation and security analysis for plugins
// Provides manifest validation, code analysis, dependency scanning, and performance checks

use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

#[cfg(test)]
mod tests;

/// Validation errors
#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("Manifest not found")]
    ManifestNotFound,

    #[error("Invalid JSON: {0}")]
    InvalidJson(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Validation failed: {0}")]
    ValidationFailed(String),

    #[error("Security violation: {0}")]
    SecurityViolation(String),
}

/// Rule severity levels
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RuleSeverity {
    Error,
    Warning,
    Info,
}

/// Issue severity for performance analysis
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum IssueSeverity {
    Critical,
    Warning,
    Info,
}

/// Rule categories
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RuleCategory {
    Manifest,
    Security,
    Performance,
    Compatibility,
    BestPractice,
    Custom,
}

/// Validation rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub severity: RuleSeverity,
    pub category: RuleCategory,
}

/// Validation issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub rule: String,
    pub severity: RuleSeverity,
    pub message: String,
    pub file: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

/// Plugin manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    #[serde(rename = "minApiVersion")]
    pub min_api_version: String,
    pub permissions: Vec<String>,
    #[serde(rename = "entryPoint")]
    pub entry_point: String,
}

/// Manifest validation report
#[derive(Debug, Serialize, Deserialize)]
pub struct ManifestReport {
    pub is_valid: bool,
    pub manifest: PluginManifest,
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

/// Security analysis report
#[derive(Debug, Serialize, Deserialize)]
pub struct SecurityReport {
    pub is_safe: bool,
    pub violations: Vec<SecurityViolation>,
    pub risk_score: u32,
}

/// Security violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityViolation {
    pub rule: String,
    pub severity: RuleSeverity,
    pub message: String,
    pub file: String,
    pub line: usize,
    pub code_snippet: Option<String>,
}

/// Dependency scan report
#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyReport {
    pub total_dependencies: usize,
    pub dev_dependencies: usize,
    pub vulnerabilities: Vec<Vulnerability>,
    pub outdated: Vec<OutdatedPackage>,
}

/// Vulnerability information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vulnerability {
    pub package: String,
    pub version: String,
    pub severity: String,
    pub description: String,
    pub fix_version: Option<String>,
}

/// Outdated package information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutdatedPackage {
    pub package: String,
    pub current_version: String,
    pub latest_version: String,
}

/// API compatibility report
#[derive(Debug, Serialize, Deserialize)]
pub struct CompatibilityReport {
    pub is_compatible: bool,
    pub required_version: String,
    pub current_version: String,
    pub breaking_changes: Vec<String>,
}

/// API usage report
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiUsageReport {
    pub deprecated_apis: Vec<DeprecatedApi>,
    pub unknown_apis: Vec<String>,
}

/// Deprecated API information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeprecatedApi {
    pub name: String,
    pub replacement: Option<String>,
    pub removal_version: Option<String>,
}

/// Performance analysis report
#[derive(Debug, Serialize, Deserialize)]
pub struct PerformanceReport {
    pub bundle_size_kb: u64,
    pub estimated_load_time_ms: u64,
    pub issues: Vec<PerformanceIssue>,
}

/// Performance issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceIssue {
    pub rule: String,
    pub severity: IssueSeverity,
    pub message: String,
    pub impact: String,
}

/// Full validation report
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationReport {
    pub plugin_id: String,
    pub plugin_name: String,
    pub overall_valid: bool,
    pub score: f64,
    pub total_errors: usize,
    pub total_warnings: usize,
    pub manifest_report: Option<ManifestReport>,
    pub security_report: Option<SecurityReport>,
    pub dependency_report: Option<DependencyReport>,
    pub compatibility_report: Option<CompatibilityReport>,
    pub performance_report: Option<PerformanceReport>,
    pub timestamp: u64,
}

/// Plugin validator
pub struct PluginValidator {
    rules: Vec<ValidationRule>,
    disabled_rules: Vec<String>,
    valid_permissions: Vec<String>,
}

impl PluginValidator {
    /// Create new validator
    pub fn new() -> Self {
        let mut validator = Self {
            rules: Vec::new(),
            disabled_rules: Vec::new(),
            valid_permissions: Self::get_valid_permissions(),
        };

        validator.initialize_rules();
        validator
    }

    /// Get validation rules
    pub fn get_rules(&self) -> &[ValidationRule] {
        &self.rules
    }

    /// Add custom rule
    pub fn add_rule(&mut self, rule: ValidationRule) {
        self.rules.push(rule);
    }

    /// Disable a rule
    pub fn disable_rule(&mut self, rule_id: &str) {
        self.disabled_rules.push(rule_id.to_string());
    }

    /// Validate entire plugin
    pub async fn validate_plugin(
        &self,
        plugin_path: &Path,
    ) -> Result<ValidationReport, ValidationError> {
        let mut report = ValidationReport {
            plugin_id: String::new(),
            plugin_name: String::new(),
            overall_valid: true,
            score: 100.0,
            total_errors: 0,
            total_warnings: 0,
            manifest_report: None,
            security_report: None,
            dependency_report: None,
            compatibility_report: None,
            performance_report: None,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        };

        // Validate manifest
        if let Ok(manifest_report) = self.validate_manifest(plugin_path).await {
            report.plugin_id = manifest_report.manifest.id.clone();
            report.plugin_name = manifest_report.manifest.name.clone();
            report.total_errors += manifest_report.errors.len();
            report.total_warnings += manifest_report.warnings.len();

            if !manifest_report.is_valid {
                report.overall_valid = false;
                report.score -= 30.0;
            }

            report.manifest_report = Some(manifest_report);
        } else {
            return Err(ValidationError::ManifestNotFound);
        }

        // Security analysis
        if let Ok(security_report) = self.analyze_security(plugin_path).await {
            if !security_report.is_safe {
                report.overall_valid = false;
                report.score -= 40.0;
                report.total_errors += security_report.violations.len();
            }
            report.security_report = Some(security_report);
        }

        // Dependency scanning
        if let Ok(dependency_report) = self.scan_dependencies(plugin_path).await {
            report.total_warnings += dependency_report.vulnerabilities.len();
            if !dependency_report.vulnerabilities.is_empty() {
                report.score -= 10.0;
            }
            report.dependency_report = Some(dependency_report);
        }

        // API compatibility
        if let Ok(compatibility_report) = self.check_api_compatibility(plugin_path, "1.0.0").await {
            if !compatibility_report.is_compatible {
                report.overall_valid = false;
                report.score -= 20.0;
            }
            report.compatibility_report = Some(compatibility_report);
        }

        // Performance analysis
        if let Ok(performance_report) = self.analyze_performance(plugin_path).await {
            report.total_warnings += performance_report.issues.len();
            if performance_report.bundle_size_kb > 1000 {
                report.score -= 5.0;
            }
            report.performance_report = Some(performance_report);
        }

        // Ensure score doesn't go below 0
        if report.score < 0.0 {
            report.score = 0.0;
        }

        Ok(report)
    }

    /// Validate manifest
    pub async fn validate_manifest(
        &self,
        plugin_path: &Path,
    ) -> Result<ManifestReport, ValidationError> {
        let manifest_path = plugin_path.join("manifest.json");

        if !manifest_path.exists() {
            return Err(ValidationError::ManifestNotFound);
        }

        let content = fs::read_to_string(&manifest_path).await?;

        // Try to parse as generic JSON first to handle incomplete manifests
        let json_value: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| ValidationError::InvalidJson(e.to_string()))?;

        // Create a default manifest and merge with parsed values
        let manifest =
            if let Ok(parsed) = serde_json::from_value::<PluginManifest>(json_value.clone()) {
                parsed
            } else {
                // Create minimal manifest with available fields
                PluginManifest {
                    id: json_value
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: json_value
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    version: json_value
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("0.0.0")
                        .to_string(),
                    description: json_value
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    author: json_value
                        .get("author")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    min_api_version: json_value
                        .get("minApiVersion")
                        .and_then(|v| v.as_str())
                        .unwrap_or("1.0.0")
                        .to_string(),
                    permissions: json_value
                        .get("permissions")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default(),
                    entry_point: json_value
                        .get("entryPoint")
                        .and_then(|v| v.as_str())
                        .unwrap_or("dist/main.js")
                        .to_string(),
                }
            };

        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // Check required fields
        if manifest.id.is_empty() {
            errors.push(ValidationIssue {
                rule: "manifest-required-fields".to_string(),
                severity: RuleSeverity::Error,
                message: "Plugin ID is required".to_string(),
                file: Some("manifest.json".to_string()),
                line: None,
                column: None,
            });
        }

        // Validate version format
        if !self.is_valid_semver(&manifest.version) {
            errors.push(ValidationIssue {
                rule: "manifest-version-format".to_string(),
                severity: RuleSeverity::Error,
                message: format!("Invalid version format: {}", manifest.version),
                file: Some("manifest.json".to_string()),
                line: None,
                column: None,
            });
        }

        // Validate permissions
        for permission in &manifest.permissions {
            if !self.valid_permissions.contains(permission) {
                warnings.push(ValidationIssue {
                    rule: "manifest-invalid-permission".to_string(),
                    severity: RuleSeverity::Warning,
                    message: format!("Unknown permission: {}", permission),
                    file: Some("manifest.json".to_string()),
                    line: None,
                    column: None,
                });
            }
        }

        // Check entry point exists
        let entry_point_path = plugin_path.join(&manifest.entry_point);
        if !entry_point_path.exists() {
            warnings.push(ValidationIssue {
                rule: "manifest-entry-point".to_string(),
                severity: RuleSeverity::Warning,
                message: format!("Entry point not found: {}", manifest.entry_point),
                file: Some("manifest.json".to_string()),
                line: None,
                column: None,
            });
        }

        Ok(ManifestReport {
            is_valid: errors.is_empty(),
            manifest,
            errors,
            warnings,
        })
    }

    /// Analyze security
    pub async fn analyze_security(
        &self,
        plugin_path: &Path,
    ) -> Result<SecurityReport, ValidationError> {
        let mut violations = Vec::new();
        let src_path = plugin_path.join("src");

        if src_path.exists() {
            let mut entries = fs::read_dir(&src_path).await?;

            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("ts")
                    || path.extension().and_then(|e| e.to_str()) == Some("js")
                {
                    let content = fs::read_to_string(&path).await?;

                    // Check for eval usage
                    if !self.disabled_rules.contains(&"no-eval".to_string())
                        && content.contains("eval(")
                    {
                        violations.push(SecurityViolation {
                            rule: "no-eval".to_string(),
                            severity: RuleSeverity::Error,
                            message: "Use of eval() is not allowed".to_string(),
                            file: path.to_string_lossy().to_string(),
                            line: self.find_line_number(&content, "eval("),
                            code_snippet: None,
                        });
                    }

                    // Check for require usage
                    if !self.disabled_rules.contains(&"no-require".to_string())
                        && content.contains("require(")
                    {
                        violations.push(SecurityViolation {
                            rule: "no-require".to_string(),
                            severity: RuleSeverity::Error,
                            message: "Direct require() is not allowed".to_string(),
                            file: path.to_string_lossy().to_string(),
                            line: self.find_line_number(&content, "require("),
                            code_snippet: None,
                        });
                    }

                    // Check for innerHTML
                    if !self.disabled_rules.contains(&"no-inner-html".to_string())
                        && content.contains(".innerHTML")
                    {
                        violations.push(SecurityViolation {
                            rule: "no-inner-html".to_string(),
                            severity: RuleSeverity::Error,
                            message: "Use of innerHTML can lead to XSS vulnerabilities".to_string(),
                            file: path.to_string_lossy().to_string(),
                            line: self.find_line_number(&content, ".innerHTML"),
                            code_snippet: None,
                        });
                    }

                    // Check for Function constructor
                    if !self
                        .disabled_rules
                        .contains(&"no-function-constructor".to_string())
                        && content.contains("new Function(")
                    {
                        violations.push(SecurityViolation {
                            rule: "no-function-constructor".to_string(),
                            severity: RuleSeverity::Error,
                            message: "Use of Function constructor is not allowed".to_string(),
                            file: path.to_string_lossy().to_string(),
                            line: self.find_line_number(&content, "new Function("),
                            code_snippet: None,
                        });
                    }
                }
            }
        }

        let risk_score = violations.len() as u32 * 10;

        Ok(SecurityReport {
            is_safe: violations.is_empty(),
            violations,
            risk_score,
        })
    }

    /// Scan dependencies
    pub async fn scan_dependencies(
        &self,
        plugin_path: &Path,
    ) -> Result<DependencyReport, ValidationError> {
        let package_json_path = plugin_path.join("package.json");

        if !package_json_path.exists() {
            return Ok(DependencyReport {
                total_dependencies: 0,
                dev_dependencies: 0,
                vulnerabilities: Vec::new(),
                outdated: Vec::new(),
            });
        }

        let content = fs::read_to_string(&package_json_path).await?;
        let package: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| ValidationError::InvalidJson(e.to_string()))?;

        let mut total_dependencies = 0;
        let mut dev_dependencies = 0;
        let mut vulnerabilities = Vec::new();

        // Count dependencies
        if let Some(deps) = package.get("dependencies").and_then(|d| d.as_object()) {
            total_dependencies = deps.len();

            // Check for known vulnerable versions (mock implementation)
            for (name, version) in deps {
                if name == "lodash" && version.as_str() == Some("4.17.19") {
                    vulnerabilities.push(Vulnerability {
                        package: name.clone(),
                        version: version.as_str().unwrap_or("").to_string(),
                        severity: "high".to_string(),
                        description: "Prototype pollution vulnerability".to_string(),
                        fix_version: Some("4.17.21".to_string()),
                    });
                }
            }
        }

        if let Some(dev_deps) = package.get("devDependencies").and_then(|d| d.as_object()) {
            dev_dependencies = dev_deps.len();
        }

        Ok(DependencyReport {
            total_dependencies,
            dev_dependencies,
            vulnerabilities,
            outdated: Vec::new(),
        })
    }

    /// Check API compatibility
    pub async fn check_api_compatibility(
        &self,
        plugin_path: &Path,
        current_version: &str,
    ) -> Result<CompatibilityReport, ValidationError> {
        let manifest_path = plugin_path.join("manifest.json");

        if !manifest_path.exists() {
            return Err(ValidationError::ManifestNotFound);
        }

        let content = fs::read_to_string(&manifest_path).await?;

        // Parse manifest, using defaults for missing fields
        let json_value: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| ValidationError::InvalidJson(e.to_string()))?;

        let manifest =
            if let Ok(parsed) = serde_json::from_value::<PluginManifest>(json_value.clone()) {
                parsed
            } else {
                PluginManifest {
                    id: json_value
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: json_value
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    version: json_value
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("0.0.0")
                        .to_string(),
                    description: json_value
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    author: json_value
                        .get("author")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    min_api_version: json_value
                        .get("minApiVersion")
                        .and_then(|v| v.as_str())
                        .unwrap_or("1.0.0")
                        .to_string(),
                    permissions: Vec::new(),
                    entry_point: json_value
                        .get("entryPoint")
                        .and_then(|v| v.as_str())
                        .unwrap_or("dist/main.js")
                        .to_string(),
                }
            };

        let required_version = manifest.min_api_version.clone();
        let is_compatible = self.is_version_compatible(&required_version, current_version);

        let mut breaking_changes = Vec::new();
        if !is_compatible {
            breaking_changes.push(format!(
                "Plugin requires API version {} but current version is {}",
                required_version, current_version
            ));
        }

        Ok(CompatibilityReport {
            is_compatible,
            required_version,
            current_version: current_version.to_string(),
            breaking_changes,
        })
    }

    /// Validate API usage
    pub async fn validate_api_usage(
        &self,
        plugin_path: &Path,
    ) -> Result<ApiUsageReport, ValidationError> {
        let mut deprecated_apis = Vec::new();
        let src_path = plugin_path.join("src");

        if src_path.exists() {
            let mut entries = fs::read_dir(&src_path).await?;

            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("ts")
                    || path.extension().and_then(|e| e.to_str()) == Some("js")
                {
                    let content = fs::read_to_string(&path).await?;

                    // Check for deprecated APIs
                    if content.contains(".adapter.read") || content.contains(".adapter.write") {
                        deprecated_apis.push(DeprecatedApi {
                            name: "vault.adapter".to_string(),
                            replacement: Some("vault.readFile / vault.writeFile".to_string()),
                            removal_version: Some("2.0.0".to_string()),
                        });
                    }
                }
            }
        }

        Ok(ApiUsageReport {
            deprecated_apis,
            unknown_apis: Vec::new(),
        })
    }

    /// Analyze performance
    pub async fn analyze_performance(
        &self,
        plugin_path: &Path,
    ) -> Result<PerformanceReport, ValidationError> {
        let mut bundle_size_kb = 0u64;
        let mut issues = Vec::new();

        // Check dist directory size
        let dist_path = plugin_path.join("dist");
        if dist_path.exists() {
            let mut entries = fs::read_dir(&dist_path).await?;

            while let Some(entry) = entries.next_entry().await? {
                let metadata = entry.metadata().await?;
                bundle_size_kb += metadata.len() / 1024;
            }
        }

        // Check for performance issues
        if bundle_size_kb > 1000 {
            issues.push(PerformanceIssue {
                rule: "bundle-size".to_string(),
                severity: IssueSeverity::Warning,
                message: format!("Bundle size is {}KB, consider optimizing", bundle_size_kb),
                impact: "Slower load times".to_string(),
            });
        }

        // Check source code for performance issues
        let src_path = plugin_path.join("src");
        if src_path.exists() {
            let mut entries = fs::read_dir(&src_path).await?;

            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("ts")
                    || path.extension().and_then(|e| e.to_str()) == Some("js")
                {
                    let content = fs::read_to_string(&path).await?;

                    // Check for synchronous loops
                    if content.contains("for (") && content.contains("document.createElement") {
                        issues.push(PerformanceIssue {
                            rule: "no-sync-loops".to_string(),
                            severity: IssueSeverity::Warning,
                            message: "Synchronous DOM operations in loop detected".to_string(),
                            impact: "Can block UI thread".to_string(),
                        });
                    }

                    // Check for busy waiting
                    if content.contains("while (") && content.contains("Date.now()") {
                        issues.push(PerformanceIssue {
                            rule: "no-sync-loops".to_string(),
                            severity: IssueSeverity::Critical,
                            message: "Busy waiting detected".to_string(),
                            impact: "Will block UI thread".to_string(),
                        });
                    }
                }
            }
        }

        let estimated_load_time_ms = bundle_size_kb * 2; // Mock calculation

        Ok(PerformanceReport {
            bundle_size_kb,
            estimated_load_time_ms,
            issues,
        })
    }

    /// Generate text report
    pub async fn generate_report(&self, report: &ValidationReport) -> String {
        let mut output = String::new();

        output.push_str("=== Plugin Validation Report ===\n\n");
        output.push_str(&format!(
            "Plugin: {} ({})\n",
            report.plugin_name, report.plugin_id
        ));
        output.push_str(&format!(
            "Status: {}\n",
            if report.overall_valid {
                "PASSED"
            } else {
                "FAILED"
            }
        ));
        output.push_str(&format!("Score: {:.1}/100\n", report.score));
        output.push_str(&format!(
            "Errors: {}, Warnings: {}\n\n",
            report.total_errors, report.total_warnings
        ));

        if let Some(manifest) = &report.manifest_report {
            output.push_str("Manifest Validation:\n");
            output.push_str(&format!("  - Valid: {}\n", manifest.is_valid));
            output.push_str(&format!("  - Errors: {}\n", manifest.errors.len()));
            output.push_str(&format!("  - Warnings: {}\n\n", manifest.warnings.len()));
        }

        if let Some(security) = &report.security_report {
            output.push_str("Security Analysis:\n");
            output.push_str(&format!("  - Safe: {}\n", security.is_safe));
            output.push_str(&format!("  - Violations: {}\n", security.violations.len()));
            output.push_str(&format!("  - Risk Score: {}\n\n", security.risk_score));
        }

        output
    }

    /// Generate JSON report
    pub async fn generate_json_report(
        &self,
        report: &ValidationReport,
    ) -> Result<serde_json::Value, ValidationError> {
        Ok(serde_json::to_value(report)
            .map_err(|e| ValidationError::ValidationFailed(e.to_string()))?)
    }

    // ===== Private Methods =====

    /// Initialize default rules
    fn initialize_rules(&mut self) {
        // Manifest rules
        self.rules.push(ValidationRule {
            id: "manifest-required-fields".to_string(),
            name: "Required Fields".to_string(),
            description: "Check for required manifest fields".to_string(),
            severity: RuleSeverity::Error,
            category: RuleCategory::Manifest,
        });

        self.rules.push(ValidationRule {
            id: "manifest-version-format".to_string(),
            name: "Version Format".to_string(),
            description: "Validate semantic version format".to_string(),
            severity: RuleSeverity::Error,
            category: RuleCategory::Manifest,
        });

        // Security rules
        self.rules.push(ValidationRule {
            id: "no-eval".to_string(),
            name: "No Eval".to_string(),
            description: "Prohibit use of eval()".to_string(),
            severity: RuleSeverity::Error,
            category: RuleCategory::Security,
        });

        self.rules.push(ValidationRule {
            id: "no-require".to_string(),
            name: "No Require".to_string(),
            description: "Prohibit direct require()".to_string(),
            severity: RuleSeverity::Error,
            category: RuleCategory::Security,
        });

        self.rules.push(ValidationRule {
            id: "no-inner-html".to_string(),
            name: "No InnerHTML".to_string(),
            description: "Prohibit innerHTML usage".to_string(),
            severity: RuleSeverity::Error,
            category: RuleCategory::Security,
        });

        // Performance rules
        self.rules.push(ValidationRule {
            id: "bundle-size".to_string(),
            name: "Bundle Size".to_string(),
            description: "Check bundle size limits".to_string(),
            severity: RuleSeverity::Warning,
            category: RuleCategory::Performance,
        });
    }

    /// Get valid permissions list
    fn get_valid_permissions() -> Vec<String> {
        vec![
            "vault:read".to_string(),
            "vault:write".to_string(),
            "vault:delete".to_string(),
            "workspace:modify".to_string(),
            "workspace:read".to_string(),
            "settings:read".to_string(),
            "settings:write".to_string(),
            "network:fetch".to_string(),
            "network:websocket".to_string(),
            "mcp:tools".to_string(),
            "mcp:resources".to_string(),
        ]
    }

    /// Check if version is valid semver
    fn is_valid_semver(&self, version: &str) -> bool {
        let parts: Vec<&str> = version.split('.').collect();
        if parts.len() != 3 {
            return false;
        }

        parts.iter().all(|part| part.parse::<u32>().is_ok())
    }

    /// Check version compatibility
    fn is_version_compatible(&self, required: &str, current: &str) -> bool {
        let required_parts: Vec<u32> = required.split('.').filter_map(|p| p.parse().ok()).collect();
        let current_parts: Vec<u32> = current.split('.').filter_map(|p| p.parse().ok()).collect();

        if required_parts.len() != 3 || current_parts.len() != 3 {
            return false;
        }

        // Major version must match or be higher
        if current_parts[0] < required_parts[0] {
            return false;
        }

        // If major matches, check minor
        if current_parts[0] == required_parts[0] && current_parts[1] < required_parts[1] {
            return false;
        }

        true
    }

    /// Find line number of pattern in content
    fn find_line_number(&self, content: &str, pattern: &str) -> usize {
        let lines: Vec<&str> = content.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.contains(pattern) {
                return i + 1;
            }
        }
        1
    }
}
