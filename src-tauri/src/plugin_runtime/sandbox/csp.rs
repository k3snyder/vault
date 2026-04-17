// Content Security Policy configuration for plugin sandboxes

use std::collections::HashMap;

/// Default CSP policy for plugin sandboxes
pub fn default_csp_policy() -> &'static str {
    // Extremely restrictive CSP for maximum security
    concat!(
        "default-src 'none'; ",
        "script-src 'self'; ",
        "style-src 'self' 'unsafe-inline'; ", // Allow inline styles for UI flexibility
        "img-src 'self' data: blob:; ",
        "font-src 'self' data:; ",
        "connect-src 'self'; ", // Will be updated based on permissions
        "frame-src 'none'; ",
        "object-src 'none'; ",
        "media-src 'none'; ",
        "worker-src 'none'; ",
        "form-action 'none'; ",
        "frame-ancestors 'none'; ",
        "base-uri 'none'; ",
        "manifest-src 'none'"
    )
}

/// CSP builder for customizing policies based on plugin permissions
pub struct CspBuilder {
    directives: HashMap<String, Vec<String>>,
}

impl CspBuilder {
    /// Create a new CSP builder with default restrictive settings
    pub fn new() -> Self {
        let mut directives = HashMap::new();

        // Start with most restrictive settings
        directives.insert("default-src".to_string(), vec!["'none'".to_string()]);
        directives.insert("script-src".to_string(), vec!["'self'".to_string()]);
        directives.insert("style-src".to_string(), vec!["'self'".to_string()]);
        directives.insert("img-src".to_string(), vec!["'self'".to_string()]);
        directives.insert("font-src".to_string(), vec!["'self'".to_string()]);
        directives.insert("connect-src".to_string(), vec!["'none'".to_string()]);
        directives.insert("frame-src".to_string(), vec!["'none'".to_string()]);
        directives.insert("object-src".to_string(), vec!["'none'".to_string()]);
        directives.insert("media-src".to_string(), vec!["'none'".to_string()]);
        directives.insert("worker-src".to_string(), vec!["'none'".to_string()]);
        directives.insert("form-action".to_string(), vec!["'none'".to_string()]);
        directives.insert("frame-ancestors".to_string(), vec!["'none'".to_string()]);
        directives.insert("base-uri".to_string(), vec!["'none'".to_string()]);

        Self { directives }
    }

    /// Allow inline styles (needed for many UI libraries)
    pub fn allow_inline_styles(&mut self) -> &mut Self {
        self.directives
            .entry("style-src".to_string())
            .and_modify(|v| {
                if !v.contains(&"'unsafe-inline'".to_string()) {
                    v.push("'unsafe-inline'".to_string());
                }
            });
        self
    }

    /// Allow data URIs for images
    pub fn allow_data_images(&mut self) -> &mut Self {
        self.directives
            .entry("img-src".to_string())
            .and_modify(|v| {
                if !v.contains(&"data:".to_string()) {
                    v.push("data:".to_string());
                }
            });
        self
    }

    /// Allow blob URLs for images
    pub fn allow_blob_images(&mut self) -> &mut Self {
        self.directives
            .entry("img-src".to_string())
            .and_modify(|v| {
                if !v.contains(&"blob:".to_string()) {
                    v.push("blob:".to_string());
                }
            });
        self
    }

    /// Allow network requests to specific domains
    pub fn allow_network(&mut self, domains: Vec<String>) -> &mut Self {
        self.directives
            .entry("connect-src".to_string())
            .and_modify(|v| {
                *v = vec!["'self'".to_string()];
                for domain in &domains {
                    if !v.contains(domain) {
                        v.push(domain.clone());
                    }
                }
            });
        self
    }

    /// Allow web workers (for background processing)
    pub fn allow_workers(&mut self) -> &mut Self {
        self.directives
            .insert("worker-src".to_string(), vec!["'self'".to_string()]);
        self
    }

    /// Allow WebAssembly execution
    pub fn allow_wasm(&mut self) -> &mut Self {
        self.directives
            .entry("script-src".to_string())
            .and_modify(|v| {
                if !v.contains(&"'wasm-unsafe-eval'".to_string()) {
                    v.push("'wasm-unsafe-eval'".to_string());
                }
            });
        self
    }

    /// Build the CSP policy string
    pub fn build(&self) -> String {
        let mut policy_parts = Vec::new();

        // Sort directives for consistent output
        let mut sorted_directives: Vec<_> = self.directives.iter().collect();
        sorted_directives.sort_by_key(|&(k, _)| k);

        for (directive, sources) in sorted_directives {
            if !sources.is_empty() {
                let directive_str = format!("{} {}", directive, sources.join(" "));
                policy_parts.push(directive_str);
            }
        }

        policy_parts.join("; ")
    }
}

/// Generate CSP policy based on plugin permissions
pub fn generate_csp_for_permissions(permissions: &[String]) -> String {
    let mut builder = CspBuilder::new();

    // Always allow inline styles for UI flexibility
    builder.allow_inline_styles();

    // Always allow data and blob URLs for images
    builder.allow_data_images();
    builder.allow_blob_images();

    // Parse permissions and adjust CSP accordingly
    for permission in permissions {
        match permission.as_str() {
            "network:*" => {
                // Allow all network requests
                builder.allow_network(vec!["*".to_string()]);
            }
            perm if perm.starts_with("network:") => {
                // Allow specific domain
                let domain = perm.strip_prefix("network:").unwrap();
                builder.allow_network(vec![domain.to_string()]);
            }
            "workers" => {
                builder.allow_workers();
            }
            "wasm" => {
                builder.allow_wasm();
            }
            _ => {
                // Unknown permission, ignore for CSP purposes
            }
        }
    }

    builder.build()
}

/// Validate a CSP policy string
pub fn validate_csp_policy(policy: &str) -> Result<(), CspError> {
    if policy.is_empty() {
        return Err(CspError::EmptyPolicy);
    }

    // Check for dangerous directives
    if policy.contains("'unsafe-eval'") {
        return Err(CspError::UnsafeEval);
    }

    if policy.contains("'unsafe-inline'") && policy.contains("script-src") {
        return Err(CspError::UnsafeInlineScript);
    }

    // Parse and validate directives
    let directives: Vec<&str> = policy.split(';').collect();
    for directive in directives {
        let parts: Vec<&str> = directive.trim().split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let directive_name = parts[0];
        if !is_valid_directive(directive_name) {
            return Err(CspError::InvalidDirective(directive_name.to_string()));
        }
    }

    Ok(())
}

/// Check if a directive name is valid
fn is_valid_directive(directive: &str) -> bool {
    matches!(
        directive,
        "default-src"
            | "script-src"
            | "style-src"
            | "img-src"
            | "font-src"
            | "connect-src"
            | "frame-src"
            | "object-src"
            | "media-src"
            | "worker-src"
            | "form-action"
            | "frame-ancestors"
            | "base-uri"
            | "manifest-src"
            | "prefetch-src"
            | "script-src-elem"
            | "script-src-attr"
            | "style-src-elem"
            | "style-src-attr"
            | "upgrade-insecure-requests"
            | "block-all-mixed-content"
            | "plugin-types"
            | "sandbox"
            | "report-uri"
            | "report-to"
            | "require-sri-for"
            | "trusted-types"
            | "navigate-to"
    )
}

#[derive(Debug, thiserror::Error)]
pub enum CspError {
    #[error("CSP policy cannot be empty")]
    EmptyPolicy,

    #[error("CSP contains unsafe-eval which is not allowed")]
    UnsafeEval,

    #[error("CSP contains unsafe-inline for scripts which is not allowed")]
    UnsafeInlineScript,

    #[error("Invalid CSP directive: {0}")]
    InvalidDirective(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_csp_policy() {
        let policy = default_csp_policy();
        assert!(policy.contains("default-src 'none'"));
        assert!(policy.contains("script-src 'self'"));
        assert!(!policy.contains("'unsafe-eval'"));
    }

    #[test]
    fn test_csp_builder_basic() {
        let builder = CspBuilder::new();
        let policy = builder.build();

        assert!(policy.contains("default-src 'none'"));
        assert!(policy.contains("script-src 'self'"));
    }

    #[test]
    fn test_csp_builder_with_permissions() {
        let mut builder = CspBuilder::new();
        builder
            .allow_inline_styles()
            .allow_data_images()
            .allow_blob_images()
            .allow_network(vec!["https://api.example.com".to_string()]);

        let policy = builder.build();

        assert!(policy.contains("style-src 'self' 'unsafe-inline'"));
        assert!(policy.contains("img-src 'self' data: blob:"));
        assert!(policy.contains("connect-src 'self' https://api.example.com"));
    }

    #[test]
    fn test_generate_csp_for_permissions() {
        let permissions = vec![
            "network:https://api.readwise.io".to_string(),
            "workers".to_string(),
            "wasm".to_string(),
        ];

        let policy = generate_csp_for_permissions(&permissions);

        assert!(policy.contains("connect-src 'self' https://api.readwise.io"));
        assert!(policy.contains("worker-src 'self'"));
        assert!(policy.contains("'wasm-unsafe-eval'"));
    }

    #[test]
    fn test_generate_csp_for_wildcard_network() {
        let permissions = vec!["network:*".to_string()];
        let policy = generate_csp_for_permissions(&permissions);

        assert!(policy.contains("connect-src 'self' *"));
    }

    #[test]
    fn test_validate_csp_policy() {
        // Test empty policy
        let result = validate_csp_policy("");
        assert!(result.is_err());

        // Test valid policy
        let result = validate_csp_policy("default-src 'none'; script-src 'self'");
        assert!(result.is_ok());

        // Test unsafe-eval
        let result = validate_csp_policy("script-src 'self' 'unsafe-eval'");
        assert!(result.is_err());

        // Test unsafe-inline scripts
        let result = validate_csp_policy("script-src 'self' 'unsafe-inline'");
        assert!(result.is_err());

        // Test invalid directive
        let result = validate_csp_policy("invalid-directive 'self'");
        assert!(result.is_err());
    }

    #[test]
    fn test_is_valid_directive() {
        assert!(is_valid_directive("default-src"));
        assert!(is_valid_directive("script-src"));
        assert!(is_valid_directive("connect-src"));
        assert!(!is_valid_directive("invalid-directive"));
        assert!(!is_valid_directive(""));
    }
}
