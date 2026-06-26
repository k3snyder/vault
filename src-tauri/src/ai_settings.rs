// AI Settings - Configuration for AI providers
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HeaderKV {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AISettings {
    pub endpoint: String,
    pub api_key: Option<String>,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    #[serde(default)]
    pub headers: Option<Vec<HeaderKV>>, // Optional custom headers for testing
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub endpoint_status: TestStatus,
    pub auth_status: TestStatus,
    pub model_status: TestStatus,
    pub overall_status: TestStatus,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestStatus {
    pub stage: String,
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub async fn test_ai_connection(settings: AISettings) -> Result<ConnectionTestResult, String> {
    println!("Testing AI connection to: {}", settings.endpoint);

    let mut result = ConnectionTestResult {
        endpoint_status: TestStatus {
            stage: "endpoint".to_string(),
            success: false,
            message: "Checking endpoint...".to_string(),
        },
        auth_status: TestStatus {
            stage: "auth".to_string(),
            success: false,
            message: "Not tested".to_string(),
        },
        model_status: TestStatus {
            stage: "model".to_string(),
            success: false,
            message: "Not tested".to_string(),
        },
        overall_status: TestStatus {
            stage: "overall".to_string(),
            success: false,
            message: "Testing...".to_string(),
        },
    };

    // Test 1: Check endpoint reachability
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    // For local endpoints, check if server is running
    if settings.endpoint.contains("localhost") || settings.endpoint.contains("127.0.0.1") {
        match client.get(&settings.endpoint).send().await {
            Ok(_) => {
                result.endpoint_status.success = true;
                result.endpoint_status.message = "Local server is running".to_string();
            }
            Err(e) => {
                result.endpoint_status.message = format!("Local server not accessible: {e}");
                result.overall_status.message = "Failed to connect to local AI server".to_string();
                return Ok(result);
            }
        }
    } else {
        // For external endpoints, check HTTPS
        if !settings.endpoint.starts_with("https://") {
            result.endpoint_status.message = "External endpoints must use HTTPS".to_string();
            result.overall_status.message = "Security error: HTTPS required".to_string();
            return Ok(result);
        }
        result.endpoint_status.success = true;
        result.endpoint_status.message = "Endpoint URL is valid".to_string();
    }

    // Test 2: Check authentication (if API key provided)
    if let Some(api_key) = &settings.api_key {
        if !api_key.is_empty() {
            // Detect Bedrock-style endpoint
            let is_bedrock = settings.endpoint.contains("/bedrock/")
                || settings.endpoint.contains("amazonaws.com/bedrock");

            if is_bedrock {
                let test_url = format!(
                    "{}/model/{}/converse",
                    settings.endpoint.trim_end_matches('/'),
                    settings.model
                );
                let test_body = serde_json::json!({
                    "messages": [
                        {"role": "user", "content": [{"text": "Hi"}]}
                    ]
                });

                let mut req = client
                    .post(&test_url)
                    .header("Authorization", format!("Bearer {api_key}"))
                    .header("Content-Type", "application/json")
                    .json(&test_body);

                // Add any custom headers from settings
                if let Some(headers) = &settings.headers {
                    for kv in headers {
                        if kv.name.is_empty() {
                            continue;
                        }
                        // Skip overwriting critical headers
                        if kv.name.eq_ignore_ascii_case("authorization")
                            || kv.name.eq_ignore_ascii_case("content-type")
                        {
                            continue;
                        }
                        req = req.header(&kv.name, &kv.value);
                    }
                }

                match req.send().await {
                    Ok(response) => {
                        if response.status() == 401 {
                            result.auth_status.message = "Invalid API key".to_string();
                            result.overall_status.message = "Authentication failed".to_string();
                            return Ok(result);
                        } else if response.status().is_success() || response.status() == 400 {
                            result.auth_status.success = true;
                            result.auth_status.message = "API key is valid".to_string();
                            result.model_status.success = true;
                            result.model_status.message = "Model is available".to_string();
                        } else {
                            result.auth_status.message =
                                format!("Unexpected status: {}", response.status());
                        }
                    }
                    Err(e) => {
                        result.auth_status.message = format!("Failed to test authentication: {e}");
                    }
                }
            } else {
                // Default: OpenAI-compatible test
                let test_url = format!(
                    "{}/chat/completions",
                    settings.endpoint.trim_end_matches('/')
                );
                let test_body = serde_json::json!({
                    "model": settings.model,
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 1,
                    "stream": false
                });

                let mut req = client
                    .post(&test_url)
                    .header("Authorization", format!("Bearer {api_key}"))
                    .header("Content-Type", "application/json")
                    .json(&test_body);

                // Add any custom headers from settings
                if let Some(headers) = &settings.headers {
                    for kv in headers {
                        if kv.name.is_empty() {
                            continue;
                        }
                        if kv.name.eq_ignore_ascii_case("authorization")
                            || kv.name.eq_ignore_ascii_case("content-type")
                        {
                            continue;
                        }
                        req = req.header(&kv.name, &kv.value);
                    }
                }

                match req.send().await {
                    Ok(response) => {
                        if response.status() == 401 {
                            result.auth_status.message = "Invalid API key".to_string();
                            result.overall_status.message = "Authentication failed".to_string();
                            return Ok(result);
                        } else if response.status().is_success() || response.status() == 400 {
                            result.auth_status.success = true;
                            result.auth_status.message = "API key is valid".to_string();
                            result.model_status.success = true;
                            result.model_status.message = "Model is available".to_string();
                        }
                    }
                    Err(e) => {
                        result.auth_status.message = format!("Failed to test authentication: {e}");
                    }
                }
            }
        } else {
            result.auth_status.success = true;
            result.auth_status.message = "No authentication required".to_string();
        }
    } else {
        result.auth_status.success = true;
        result.auth_status.message = "No authentication required".to_string();
    }

    // Set overall status
    if result.endpoint_status.success && result.auth_status.success {
        result.overall_status.success = true;
        result.overall_status.message = "Connection successful!".to_string();
    }

    Ok(result)
}
