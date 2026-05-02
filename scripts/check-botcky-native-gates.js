#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const failures = [];
const audits = [];

function walk(dir, predicate = () => true) {
  const absolute = path.join(repoRoot, dir);
  if (!fs.existsSync(absolute)) return [];
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(rel, predicate));
    } else if (entry.isFile() && predicate(rel)) {
      out.push(rel);
    }
  }
  return out;
}

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function scan(files, regex, description, { fail = true, allow = () => false } = {}) {
  for (const file of files) {
    const text = read(file);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (regex.test(line) && !allow(file, line)) {
        const hit = `${file}:${index + 1}: ${line.trim()}`;
        (fail ? failures : audits).push(`${description}: ${hit}`);
      }
      regex.lastIndex = 0;
    });
  }
}

const jsLike = rel => /\.(js|jsx|ts|tsx)$/.test(rel);
const rustLike = rel => /\.rs$/.test(rel);

const botckyFrontend = walk('src/botcky', jsLike);
if (botckyFrontend.length === 0) {
  failures.push('Native Botcky frontend module is missing: expected files under src/botcky');
}
scan(botckyFrontend, /\/ws\/vault|BotckyGatewaySDK/, 'Native Botcky frontend must not reference legacy connector');

const botckyRust = walk('src-tauri/src/botcky', rustLike);
if (botckyRust.length === 0) {
  failures.push('Native Botcky Rust module is missing: expected files under src-tauri/src/botcky');
}
scan(
  botckyRust,
  /\bpty\b|ghostty|portable_pty|Command::new\((?:"|')?(?:sh|bash|zsh)(?:"|')?\)/i,
  'Native Botcky Rust bridge must not use raw terminal/shell bypasses'
);

const enhanced = fs.existsSync(path.join(repoRoot, 'src/chat/EnhancedChatPanel.js'))
  ? ['src/chat/EnhancedChatPanel.js']
  : [];
scan(
  enhanced,
  /new BotckyGatewaySDK|import\s+\{?\s*BotckyGatewaySDK|\.chat\([^\n]*botckyGateway|\/ws\/vault/,
  'EnhancedChatPanel must not retain legacy Botcky SDK or connector websocket routing'
);

const auditFiles = [
  ...walk('src', jsLike),
  ...walk('src-tauri/src', rustLike),
];
const allowedLegacy = new Set([
  'src-tauri/src/ai_settings_multi.rs',
]);
scan(
  auditFiles,
  /BotckyGatewaySDK|\/ws\/vault/,
  'Legacy Botcky connector symbol audit',
  {
    fail: false,
    allow: file => allowedLegacy.has(file) || file.startsWith('src/botcky/') || file.startsWith('src-tauri/src/botcky/'),
  }
);

if (audits.length > 0) {
  console.log('Botcky provider audit hits (expected only in native/settings compatibility surfaces):');
  for (const audit of audits) console.log(`- ${audit}`);
}

if (failures.length > 0) {
  console.error('Botcky native static gates failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Botcky native static gates passed (${botckyFrontend.length} frontend files, ${botckyRust.length} Rust files scanned).`);
