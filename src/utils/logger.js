import { invoke } from '@tauri-apps/api/core';

const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

function stringifyDetail(detail) {
  if (detail == null) {
    return null;
  }

  return String(detail?.stack ?? detail);
}

function forward(level, module, message, detail) {
  invoke('frontend_log', {
    entry: {
      level,
      module,
      message,
      detail: stringifyDetail(detail),
    },
  }).catch(() => {});
}

export function createLogger(module) {
  return {
    debug: (...args) => {
      if (DEV) {
        console.log(`[${module}]`, ...args);
      }
    },
    info: (message, detail) => {
      forward('info', module, message, detail);
    },
    warn: (message, detail) => {
      console.warn(`[${module}]`, message, detail ?? '');
      forward('warn', module, message, detail);
    },
    error: (message, detail) => {
      console.error(`[${module}]`, message, detail ?? '');
      forward('error', module, message, detail);
    },
    // Expected, suppressed errors in hot paths: must stay as cheap as the
    // empty catch blocks they replaced. Dev-console only — no IPC forward.
    swallow: (context, error) => {
      if (DEV) {
        console.debug(`[${module}]`, `${context} (suppressed)`, error);
      }
    },
  };
}
