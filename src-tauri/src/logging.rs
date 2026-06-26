use serde::Deserialize;
use std::error::Error;
use std::path::Path;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::EnvFilter;

pub struct LogGuard(#[allow(dead_code)] WorkerGuard);

#[derive(Debug, Deserialize)]
pub struct FrontendLogEntry {
    level: String,
    module: String,
    message: String,
    detail: Option<String>,
}

pub fn init(app: &tauri::App) -> Result<LogGuard, Box<dyn Error + Send + Sync>> {
    let log_dir = app.path().app_log_dir()?;
    std::fs::create_dir_all(&log_dir)?;

    let appender = rolling_appender(&log_dir)?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_ansi(false)
        .try_init()?;

    Ok(LogGuard(guard))
}

fn rolling_appender(log_dir: &Path) -> Result<RollingFileAppender, Box<dyn Error + Send + Sync>> {
    Ok(tracing_appender::rolling::Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("vault")
        .filename_suffix("log")
        .max_log_files(7)
        .build(log_dir)?)
}

#[tauri::command]
pub fn frontend_log(entry: FrontendLogEntry) {
    record(&entry);
}

pub fn record(entry: &FrontendLogEntry) {
    let detail = entry.detail.as_deref().unwrap_or("");

    match entry.level.as_str() {
        "error" => tracing::error!(
            target: "frontend",
            module = %entry.module,
            detail = %detail,
            "{}",
            entry.message
        ),
        "warn" => tracing::warn!(
            target: "frontend",
            module = %entry.module,
            detail = %detail,
            "{}",
            entry.message
        ),
        _ => tracing::info!(
            target: "frontend",
            module = %entry.module,
            detail = %detail,
            "{}",
            entry.message
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Write};
    use std::sync::{Arc, Mutex};
    use tracing::subscriber::with_default;
    use tracing_subscriber::fmt::MakeWriter;

    #[derive(Clone)]
    struct SharedWriter(Arc<Mutex<Vec<u8>>>);

    impl<'a> MakeWriter<'a> for SharedWriter {
        type Writer = SharedBuffer;

        fn make_writer(&'a self) -> Self::Writer {
            SharedBuffer(self.0.clone())
        }
    }

    struct SharedBuffer(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedBuffer {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn frontend_log_writes_through_tracing() {
        let buffer = Arc::new(Mutex::new(Vec::new()));
        let writer = SharedWriter(buffer.clone());
        let subscriber = tracing_subscriber::fmt()
            .with_writer(writer)
            .with_ansi(false)
            .finish();

        let entry = FrontendLogEntry {
            level: "warn".to_string(),
            module: "logger-test".to_string(),
            message: "frontend warning".to_string(),
            detail: Some("detail text".to_string()),
        };

        with_default(subscriber, || record(&entry));

        let output = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
        assert!(output.contains("logger-test"));
        assert!(output.contains("frontend warning"));
        assert!(output.contains("detail text"));
        assert!(output.contains("WARN"));
    }

    #[test]
    fn rolling_appender_creates_file_in_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let appender = rolling_appender(temp_dir.path()).unwrap();
        let (writer, guard) = tracing_appender::non_blocking(appender);
        let subscriber = tracing_subscriber::fmt()
            .with_writer(writer)
            .with_ansi(false)
            .finish();

        with_default(subscriber, || {
            tracing::info!("rolling appender smoke");
        });
        drop(guard);

        let entries = std::fs::read_dir(temp_dir.path())
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);

        let path = entries[0].path();
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("vault."));
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".log"));

        let contents = std::fs::read_to_string(path).unwrap();
        assert!(contents.contains("rolling appender smoke"));
    }
}
