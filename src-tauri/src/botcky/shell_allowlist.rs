use super::path_safety::{canonical_scope, resolve_target, BotckyPathScope, TargetMode};
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

const DEFAULT_TIMEOUT_MS: u64 = 5_000;
const MAX_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_OUTPUT_LIMIT: usize = 64_000;
const MAX_OUTPUT_LIMIT: usize = 256_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckyShellRequest {
    pub vault_root: String,
    #[serde(default)]
    pub current_folder: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    pub command: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub output_limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotckyShellResult {
    pub success: bool,
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAllowedCommand {
    pub program: String,
    pub args: Vec<String>,
}

#[tauri::command]
pub async fn botcky_run_allowed_command(
    request: BotckyShellRequest,
) -> Result<BotckyShellResult, String> {
    let scope = canonical_scope(&request.vault_root, request.current_folder.as_deref())
        .map_err(|err| err.to_string())?;
    let cwd_scope = if let Some(cwd) = request
        .cwd
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        canonical_scope(&request.vault_root, Some(cwd)).map_err(|err| err.to_string())?
    } else {
        scope
    };
    let parsed = harden_command_paths(parse_allowed_command(&request.command)?, &cwd_scope)?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1, MAX_TIMEOUT_MS);
    let output_limit = request
        .output_limit
        .unwrap_or(DEFAULT_OUTPUT_LIMIT)
        .clamp(1, MAX_OUTPUT_LIMIT);
    let mut command = Command::new(&parsed.program);
    command
        .args(&parsed.args)
        .current_dir(&cwd_scope.current_folder)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|err| format!("failed to spawn allowlisted command: {err}"))?;

    let mut stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let mut stderr = child.stderr.take().ok_or("failed to capture stderr")?;
    let wait = async move {
        let status = child.wait().await.map_err(|err| err.to_string())?;
        let mut out = Vec::new();
        let mut err = Vec::new();
        stdout
            .read_to_end(&mut out)
            .await
            .map_err(|err| err.to_string())?;
        stderr
            .read_to_end(&mut err)
            .await
            .map_err(|err| err.to_string())?;
        Ok::<_, String>((status.code(), out, err))
    };
    let (status, stdout, stderr) = timeout(Duration::from_millis(timeout_ms), wait)
        .await
        .map_err(|_| "allowlisted command timed out".to_string())??;
    let (stdout, stdout_truncated) = limit_output(stdout, output_limit);
    let (stderr, stderr_truncated) = limit_output(stderr, output_limit);
    Ok(BotckyShellResult {
        success: status == Some(0),
        status,
        stdout,
        stderr,
        truncated: stdout_truncated || stderr_truncated,
    })
}

pub fn parse_allowed_command(command: &str) -> Result<ParsedAllowedCommand, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("command is required".into());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.contains('\0') {
        return Err("command contains forbidden control characters".into());
    }
    if contains_shell_meta(trimmed) {
        return Err(
            "shell metacharacters, interpolation, redirects, pipes, and globbing are not allowed"
                .into(),
        );
    }
    let parts = trimmed
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let Some(program) = parts.first() else {
        return Err("command is required".into());
    };
    let args = parts[1..].to_vec();
    match program.as_str() {
        "pwd" => {
            if !args.is_empty() {
                return Err("pwd does not accept args in Botcky MVP".into());
            }
        }
        "ls" => validate_simple_args(&args, &["-1", "-a", "-la", "-al", "-l"])?,
        "cat" | "head" | "tail" | "wc" | "grep" | "rg" => {
            validate_file_command_args(program, &args)?
        }
        "find" => validate_find_args(&args)?,
        denied if is_destructive_program(denied) => {
            return Err(format!("destructive command denied: {denied}"))
        }
        other => return Err(format!("command is not in Botcky MVP allowlist: {other}")),
    }
    Ok(ParsedAllowedCommand {
        program: program.clone(),
        args,
    })
}

fn contains_shell_meta(value: &str) -> bool {
    value.chars().any(|ch| {
        matches!(
            ch,
            '|' | '&'
                | ';'
                | '>'
                | '<'
                | '$'
                | '`'
                | '('
                | ')'
                | '{'
                | '}'
                | '['
                | ']'
                | '*'
                | '?'
                | '~'
                | '!'
                | '\\'
        )
    })
}

fn is_destructive_program(program: &str) -> bool {
    matches!(
        program,
        "rm" | "mv"
            | "rmdir"
            | "unlink"
            | "truncate"
            | "chmod"
            | "chown"
            | "dd"
            | "shred"
            | "sed"
            | "perl"
            | "python"
            | "python3"
            | "node"
            | "bash"
            | "sh"
            | "zsh"
    )
}

fn validate_simple_args(args: &[String], allowed_flags: &[&str]) -> Result<(), String> {
    for arg in args {
        if arg.starts_with('-') && !allowed_flags.contains(&arg.as_str()) {
            return Err(format!("flag denied: {arg}"));
        }
        validate_relative_arg(arg)?;
    }
    Ok(())
}

fn validate_file_command_args(program: &str, args: &[String]) -> Result<(), String> {
    let allowed_flags = match program {
        "head" | "tail" => &["-n"] as &[&str],
        "grep" | "rg" => &["-n", "-i", "--line-number", "--ignore-case"],
        "wc" => &["-l", "-w", "-c"],
        _ => &[],
    };
    let mut expect_flag_value = false;
    for arg in args {
        if expect_flag_value {
            if arg.parse::<u64>().is_err() {
                return Err("numeric flag value required".into());
            }
            expect_flag_value = false;
            continue;
        }
        if arg == "-n" && (program == "head" || program == "tail") {
            expect_flag_value = true;
            continue;
        }
        if arg.starts_with('-') {
            if !allowed_flags.contains(&arg.as_str()) {
                return Err(format!("flag denied: {arg}"));
            }
            continue;
        }
        validate_relative_arg(arg)?;
    }
    if expect_flag_value {
        return Err("missing numeric value after -n".into());
    }
    Ok(())
}

fn validate_find_args(args: &[String]) -> Result<(), String> {
    for arg in args {
        if matches!(
            arg.as_str(),
            "-delete" | "-exec" | "-execdir" | "-ok" | "-okdir"
        ) {
            return Err(format!("destructive find argument denied: {arg}"));
        }
        if arg.starts_with('-')
            && !matches!(arg.as_str(), "-name" | "-type" | "-maxdepth" | "-mindepth")
        {
            return Err(format!("find flag denied: {arg}"));
        }
        if !arg.starts_with('-') {
            validate_relative_arg(arg)?;
        }
    }
    Ok(())
}

fn validate_relative_arg(arg: &str) -> Result<(), String> {
    if arg.starts_with('/') || arg.contains("..") || arg.contains('\0') {
        return Err(format!("unsafe path argument denied: {arg}"));
    }
    Ok(())
}

fn harden_command_paths(
    mut parsed: ParsedAllowedCommand,
    scope: &BotckyPathScope,
) -> Result<ParsedAllowedCommand, String> {
    match parsed.program.as_str() {
        "pwd" => {}
        "ls" => harden_path_args(&mut parsed.args, scope, |_| false)?,
        "cat" | "wc" => harden_path_args(&mut parsed.args, scope, |_| false)?,
        "head" | "tail" => harden_path_args(&mut parsed.args, scope, skip_numeric_flag_value)?,
        "grep" | "rg" => harden_search_args(&mut parsed.args, scope)?,
        "find" => harden_find_path_arg(&mut parsed.args, scope)?,
        _ => {}
    }
    Ok(parsed)
}

fn harden_path_args(
    args: &mut [String],
    scope: &BotckyPathScope,
    mut skip_next: impl FnMut(&str) -> bool,
) -> Result<(), String> {
    let mut skip_value = false;
    for arg in args.iter_mut() {
        if skip_value {
            skip_value = false;
            continue;
        }
        if skip_next(arg) {
            skip_value = true;
            continue;
        }
        if arg.starts_with('-') {
            continue;
        }
        *arg = canonical_command_arg(scope, arg)?;
    }
    Ok(())
}

fn harden_search_args(args: &mut [String], scope: &BotckyPathScope) -> Result<(), String> {
    let mut saw_pattern = false;
    for arg in args.iter_mut() {
        if arg.starts_with('-') {
            continue;
        }
        if !saw_pattern {
            saw_pattern = true;
            continue;
        }
        *arg = canonical_command_arg(scope, arg)?;
    }
    Ok(())
}

fn harden_find_path_arg(args: &mut [String], scope: &BotckyPathScope) -> Result<(), String> {
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "-name" | "-type" | "-maxdepth" | "-mindepth" => {
                index += 2;
            }
            flag if flag.starts_with('-') => {
                index += 1;
            }
            _ => {
                args[index] = canonical_command_arg(scope, &args[index])?;
                break;
            }
        }
    }
    Ok(())
}

fn skip_numeric_flag_value(arg: &str) -> bool {
    arg == "-n"
}

fn canonical_command_arg(scope: &BotckyPathScope, arg: &str) -> Result<String, String> {
    resolve_target(scope, arg, TargetMode::MustExist)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|err| format!("unsafe command path argument denied: {err}"))
}

fn limit_output(bytes: Vec<u8>, limit: usize) -> (String, bool) {
    let truncated = bytes.len() > limit;
    let slice = if truncated {
        &bytes[..limit]
    } else {
        &bytes[..]
    };
    (String::from_utf8_lossy(slice).into_owned(), truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn accepts_allowlisted_non_shell_command() {
        let parsed = parse_allowed_command("rg -n hello notes").unwrap();
        assert_eq!(parsed.program, "rg");
        assert_eq!(parsed.args, vec!["-n", "hello", "notes"]);
    }

    #[test]
    fn denies_shell_metacharacters_and_destructive_programs() {
        for command in [
            "echo hi | cat",
            "cat $(pwd)",
            "cat a > b",
            "rm file",
            "mv a b",
            "bash -lc pwd",
            "find . -delete",
        ] {
            assert!(
                parse_allowed_command(command).is_err(),
                "{command} should be denied"
            );
        }
    }

    #[tokio::test]
    async fn runs_pwd_inside_current_folder() {
        let dir = tempdir().unwrap();
        let result = botcky_run_allowed_command(BotckyShellRequest {
            vault_root: dir.path().to_string_lossy().to_string(),
            current_folder: None,
            cwd: None,
            command: "pwd".into(),
            timeout_ms: Some(5000),
            output_limit: Some(4096),
        })
        .await
        .unwrap();
        assert!(result.success);
        let expected = dir.path().canonicalize().unwrap();
        assert!(result.stdout.trim().starts_with(expected.to_str().unwrap()));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_allowlisted_command_path_symlink_escape() {
        use std::fs;
        use std::os::unix::fs::symlink;

        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::write(outside.path().join("secret.md"), "secret").unwrap();
        symlink(
            outside.path().join("secret.md"),
            dir.path().join("notes/link.md"),
        )
        .unwrap();

        let err = botcky_run_allowed_command(BotckyShellRequest {
            vault_root: dir.path().to_string_lossy().to_string(),
            current_folder: Some("notes".into()),
            cwd: None,
            command: "cat link.md".into(),
            timeout_ms: Some(5000),
            output_limit: Some(4096),
        })
        .await
        .unwrap_err();

        assert!(err.contains("unsafe command path argument denied"));
    }
}
