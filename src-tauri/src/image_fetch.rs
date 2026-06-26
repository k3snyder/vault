use base64::{engine::general_purpose, Engine as _};
use futures_util::StreamExt;
use reqwest::{redirect, Url};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use tokio::net::lookup_host;
use url::Host;

const MAX_REDIRECTS: usize = 5;
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default)]
pub struct ImageFetchPolicy {
    pub allow_http: bool,
    pub allow_private_network: bool,
}

pub fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_forbidden_ipv4(ip),
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_forbidden_ipv4(mapped);
            }

            ip.is_loopback()
                || ip.is_unspecified()
                || is_ipv6_unique_local(ip)
                || is_ipv6_link_local(ip)
        }
    }
}

fn is_forbidden_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
        || is_ipv4_shared(ip)
}

fn is_ipv4_shared(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn is_ipv6_unique_local(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xfe00) == 0xfc00
}

fn is_ipv6_link_local(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xffc0) == 0xfe80
}

pub fn validate_url(url: &Url, policy: &ImageFetchPolicy) -> Result<(), String> {
    match url.scheme() {
        "https" => {}
        "http" if policy.allow_http => {}
        "http" => {
            return Err("Image fetch policy blocks http URLs for this vault".to_string());
        }
        scheme => {
            return Err(format!(
                "Image fetch policy blocks unsupported URL scheme: {scheme}"
            ));
        }
    }

    match url.host() {
        Some(Host::Ipv4(ip)) => validate_ip(IpAddr::V4(ip), policy),
        Some(Host::Ipv6(ip)) => validate_ip(IpAddr::V6(ip), policy),
        Some(Host::Domain(_)) => Ok(()),
        None => Err("Image fetch policy requires a URL host".to_string()),
    }
}

fn validate_ip(ip: IpAddr, policy: &ImageFetchPolicy) -> Result<(), String> {
    if !policy.allow_private_network && is_forbidden_ip(ip) {
        return Err(format!(
            "Image fetch policy blocks private or local network address: {ip}"
        ));
    }

    Ok(())
}

pub async fn resolve_and_validate(
    host: &str,
    port: u16,
    policy: &ImageFetchPolicy,
) -> Result<Vec<SocketAddr>, String> {
    let addrs: Vec<SocketAddr> = lookup_host((host, port))
        .await
        .map_err(|e| format!("Failed to resolve image host {host}: {e}"))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("Failed to resolve image host {host}: no addresses"));
    }

    for addr in &addrs {
        validate_ip(addr.ip(), policy)?;
    }

    Ok(addrs)
}

pub fn sanitize_content_type(content_type: &str) -> &str {
    let trimmed = content_type.trim();
    if !trimmed.starts_with("image/") {
        return "application/octet-stream";
    }

    let subtype = &trimmed["image/".len()..];
    if subtype.is_empty() {
        return "application/octet-stream";
    }

    if subtype
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'+' | b'-'))
    {
        trimmed
    } else {
        "application/octet-stream"
    }
}

pub async fn fetch_image(url: &str, policy: &ImageFetchPolicy) -> Result<String, String> {
    let mut current_url =
        Url::parse(url).map_err(|e| format!("Invalid image URL for fetch policy: {e}"))?;
    let mut redirect_count = 0usize;

    loop {
        validate_url(&current_url, policy)?;
        let host = current_url
            .host_str()
            .ok_or_else(|| "Image fetch policy requires a URL host".to_string())?
            .to_string();
        let port = current_url
            .port_or_known_default()
            .ok_or_else(|| "Image URL is missing a usable port".to_string())?;
        let addrs = resolve_and_validate(&host, port, policy).await?;

        let client = reqwest::Client::builder()
            .redirect(redirect::Policy::none())
            .resolve_to_addrs(&host, &addrs)
            .build()
            .map_err(|e| format!("Failed to create image fetch client: {e}"))?;

        let response = client
            .get(current_url.clone())
            .send()
            .await
            .map_err(|e| format!("Failed to fetch image: {e}"))?;

        if response.status().is_redirection() {
            if redirect_count >= MAX_REDIRECTS {
                return Err("Image fetch redirect limit exceeded".to_string());
            }

            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "Image fetch redirect missing Location header".to_string())?;
            current_url = current_url
                .join(location)
                .map_err(|e| format!("Invalid image fetch redirect URL: {e}"))?;
            redirect_count += 1;
            continue;
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(sanitize_content_type)
            .unwrap_or("application/octet-stream")
            .to_string();

        if let Some(content_length) = response.content_length() {
            if content_length > MAX_IMAGE_BYTES as u64 {
                return Err("Image fetch policy blocks responses larger than 25 MB".to_string());
            }
        }

        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Failed to read image bytes: {e}"))?;
            if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
                return Err("Image fetch policy blocks responses larger than 25 MB".to_string());
            }
            bytes.extend_from_slice(&chunk);
        }

        let base64_string = general_purpose::STANDARD.encode(&bytes);
        return Ok(format!("data:{content_type};base64,{base64_string}"));
    }
}

#[cfg(test)]
mod tests {
    use crate::image_fetch::{
        fetch_image, is_forbidden_ip, sanitize_content_type, validate_url, ImageFetchPolicy,
    };
    use std::net::IpAddr;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::time::{timeout, Duration};

    #[test]
    fn forbidden_ip_matrix() {
        let forbidden = [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fc00::1",
            "::ffff:127.0.0.1",
        ];
        for ip in forbidden {
            let parsed: IpAddr = ip.parse().expect("test IP should parse");
            assert!(is_forbidden_ip(parsed), "{ip} should be forbidden");
        }

        let allowed = ["1.1.1.1", "93.184.216.34", "2606:4700::1111"];
        for ip in allowed {
            let parsed: IpAddr = ip.parse().expect("test IP should parse");
            assert!(!is_forbidden_ip(parsed), "{ip} should be allowed");
        }
    }

    #[test]
    fn http_scheme_rejected_by_default() {
        let url = reqwest::Url::parse("http://example.com/image.png").unwrap();

        let error = validate_url(&url, &ImageFetchPolicy::default()).unwrap_err();

        assert!(error.contains("http"));
    }

    #[test]
    fn http_allowed_when_policy_permits() {
        let url = reqwest::Url::parse("http://example.com/image.png").unwrap();
        let policy = ImageFetchPolicy {
            allow_http: true,
            allow_private_network: false,
        };

        validate_url(&url, &policy).unwrap();
    }

    #[tokio::test]
    async fn localhost_fetch_rejected_e2e() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let result = fetch_image(
            &format!("http://127.0.0.1:{}/x", addr.port()),
            &ImageFetchPolicy::default(),
        )
        .await;

        let error = result.unwrap_err();
        assert!(error.contains("http") || error.contains("private") || error.contains("local"));
        assert!(
            timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err(),
            "policy rejection should happen before connecting to localhost"
        );
    }

    #[tokio::test]
    async fn redirects_are_followed_manually_and_capped() {
        let (base_url, server) = spawn_redirect_server(6).await;
        let policy = ImageFetchPolicy {
            allow_http: true,
            allow_private_network: true,
        };

        let result = fetch_image(&format!("{base_url}/hop/0"), &policy).await;

        assert!(result.unwrap_err().contains("redirect limit"));
        server.abort();

        let (base_url, server) = spawn_redirect_server(2).await;
        let result = fetch_image(&format!("{base_url}/hop/0"), &policy)
            .await
            .unwrap();

        assert!(result.starts_with("data:image/png;base64,"));
        server.abort();
    }

    #[tokio::test]
    async fn content_type_sanitized() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 1024];
            let _ = socket.read(&mut buffer).await.unwrap();
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/html;evil\r\nContent-Length: 3\r\n\r\nabc",
                )
                .await
                .unwrap();
        });
        let policy = ImageFetchPolicy {
            allow_http: true,
            allow_private_network: true,
        };

        let result = fetch_image(&format!("http://127.0.0.1:{}/x", addr.port()), &policy)
            .await
            .unwrap();

        assert!(result.starts_with("data:application/octet-stream;base64,"));
        server.await.unwrap();
    }

    #[test]
    fn sanitizes_content_type_values() {
        assert_eq!(sanitize_content_type("image/png"), "image/png");
        assert_eq!(sanitize_content_type("image/svg+xml"), "image/svg+xml");
        assert_eq!(
            sanitize_content_type("text/html;evil"),
            "application/octet-stream"
        );
        assert_eq!(
            sanitize_content_type("image/png;charset=utf-8"),
            "application/octet-stream"
        );
    }

    async fn spawn_redirect_server(depth: usize) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://127.0.0.1:{}", addr.port());
        let server_base_url = base_url.clone();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buffer = [0u8; 1024];
                let Ok(read) = socket.read(&mut buffer).await else {
                    continue;
                };
                let request = String::from_utf8_lossy(&buffer[..read]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                let index = path
                    .strip_prefix("/hop/")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(depth);

                if index < depth {
                    let location = format!("{server_base_url}/hop/{}", index + 1);
                    let response = format!(
                        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\n\r\n"
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                } else {
                    let _ = socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\nabc",
                        )
                        .await;
                }
            }
        });

        (base_url, server)
    }
}
