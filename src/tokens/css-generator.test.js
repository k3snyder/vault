/**
 * Tests for CSS Generator Utilities
 *
 * These tests verify the functionality of the css-generator module.
 * Run with: node css-generator.test.js
 */

import {
  kebabCase,
  generateCSSVariables,
  applyTheme,
  getSystemTheme,
  watchSystemTheme
} from './css-generator.js';

// Test counter
let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✓ ${description}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${description}`);
    console.error(`  ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Test kebabCase
test('kebabCase converts "bgPrimary" to "bg-primary"', () => {
  assert(kebabCase('bgPrimary') === 'bg-primary');
});

test('kebabCase converts "textSecondary" to "text-secondary"', () => {
  assert(kebabCase('textSecondary') === 'text-secondary');
});

test('kebabCase handles single word', () => {
  assert(kebabCase('text') === 'text');
});

test('kebabCase handles consecutive capitals', () => {
  assert(kebabCase('HTMLElement') === 'html-element');
});

// Test generateCSSVariables
test('generateCSSVariables returns string for light theme', () => {
  const css = generateCSSVariables('light');
  assert(typeof css === 'string');
  assert(css.length > 0);
});

test('generateCSSVariables includes bg-primary variable', () => {
  const css = generateCSSVariables('light');
  assert(css.includes('--bg-primary:'));
});

test('generateCSSVariables includes text-primary variable', () => {
  const css = generateCSSVariables('dark');
  assert(css.includes('--text-primary:'));
});

test('generateCSSVariables returns different values for light vs dark', () => {
  const lightCSS = generateCSSVariables('light');
  const darkCSS = generateCSSVariables('dark');
  assert(lightCSS !== darkCSS);
});

// Test applyTheme (requires DOM - mock check)
test('applyTheme function exists and is callable', () => {
  assert(typeof applyTheme === 'function');
});

// Test getSystemTheme (requires window.matchMedia - mock check)
test('getSystemTheme function exists and returns string', () => {
  assert(typeof getSystemTheme === 'function');
  const theme = getSystemTheme();
  assert(theme === 'light' || theme === 'dark');
});

// Test watchSystemTheme
test('watchSystemTheme returns a function', () => {
  const cleanup = watchSystemTheme(() => {});
  assert(typeof cleanup === 'function');
  cleanup(); // Clean up
});

// Results
console.log('\n' + '='.repeat(50));
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
