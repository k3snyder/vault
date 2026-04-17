/**
 * CSS Generator Utilities
 *
 * Utilities for generating and applying CSS custom properties from design tokens.
 * Supports dynamic theme switching and system theme detection.
 *
 * @module tokens/css-generator
 * @version 1.0.0
 */

import { lightTheme, darkTheme } from './colors.js';

/**
 * Converts camelCase string to kebab-case
 *
 * @param {string} str - The camelCase string to convert
 * @returns {string} The kebab-case string
 *
 * @example
 * kebabCase('bgPrimary') // returns 'bg-primary'
 * kebabCase('textSecondary') // returns 'text-secondary'
 */
export function kebabCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Generates CSS custom properties string from theme tokens
 *
 * @param {string} themeName - The theme name ('light' or 'dark')
 * @returns {string} CSS string with custom property definitions
 *
 * @example
 * const css = generateCSSVariables('light');
 * // Returns: '--bg-primary: #ffffff;\n--text-primary: #171717;\n...'
 */
export function generateCSSVariables(themeName) {
  const theme = themeName === 'dark' ? darkTheme : lightTheme;

  return Object.entries(theme)
    .map(([key, value]) => `--${kebabCase(key)}: ${value};`)
    .join('\n');
}

/**
 * Applies theme tokens as CSS custom properties on document root
 * Sets data-theme attribute for CSS selector targeting
 *
 * @param {string} themeName - The theme name ('light' or 'dark')
 *
 * @example
 * applyTheme('dark'); // Applies dark theme tokens to document root
 * applyTheme('light'); // Applies light theme tokens to document root
 */
export function applyTheme(themeName) {
  console.log(`[Theme] applyTheme called with: "${themeName}"`);
  console.log(`[Theme] Current data-theme before: "${document.documentElement.getAttribute('data-theme')}"`);

  const theme = themeName === 'dark' ? darkTheme : lightTheme;
  const root = document.documentElement;

  // Apply each token as a CSS custom property
  let appliedCount = 0;
  Object.entries(theme).forEach(([key, value]) => {
    root.style.setProperty(`--${kebabCase(key)}`, value);
    appliedCount++;
  });
  console.log(`[Theme] Applied ${appliedCount} CSS variables`);
  console.log(`[Theme] Sample values: --bg-primary=${theme.bgPrimary}, --bg-secondary=${theme.bgSecondary}, --text-primary=${theme.textPrimary}`);

  // Set data-theme attribute for CSS selector targeting
  root.setAttribute('data-theme', themeName);
  console.log(`[Theme] Set data-theme to: "${themeName}"`);
  console.log(`[Theme] Computed --bg-secondary: ${getComputedStyle(root).getPropertyValue('--bg-secondary')}`);
}

/**
 * Detects system color scheme preference
 *
 * @returns {string} 'dark' if system prefers dark mode, 'light' otherwise
 *
 * @example
 * const systemTheme = getSystemTheme();
 * console.log(systemTheme); // 'dark' or 'light'
 */
export function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Watches for system color scheme changes and calls callback when changed
 * Returns cleanup function to remove event listener
 *
 * @param {Function} callback - Function to call when system theme changes
 * @returns {Function} Cleanup function to remove the listener
 *
 * @example
 * const cleanup = watchSystemTheme((newTheme) => {
 *   console.log('System theme changed to:', newTheme);
 *   applyTheme(newTheme);
 * });
 *
 * // Later, when you want to stop watching:
 * cleanup();
 */
export function watchSystemTheme(callback) {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => {}; // No-op cleanup function
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const handler = (event) => {
    const newTheme = event.matches ? 'dark' : 'light';
    callback(newTheme);
  };

  // Add listener (use addEventListener for modern browsers)
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handler);
  } else {
    // Fallback for older browsers
    mediaQuery.addListener(handler);
  }

  // Return cleanup function
  return () => {
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener('change', handler);
    } else {
      // Fallback for older browsers
      mediaQuery.removeListener(handler);
    }
  };
}
