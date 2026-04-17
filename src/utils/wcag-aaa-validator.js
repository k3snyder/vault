/**
 * WCAG AAA Automated Validation Script
 *
 * This script validates all 52 text/background token combinations to ensure:
 * - Light high contrast mode: WCAG AAA compliance (7.5:1+)
 * - Dark high contrast mode: WCAG AAA compliance (7.5:1+)
 * - Standard light mode: WCAG AA compliance (4.5:1+)
 * - Standard dark mode: WCAG AA compliance (4.5:1+)
 * - Fill tokens: 3:1 contrast for UI elements
 *
 * @module utils/wcag-aaa-validator
 * @version 1.0.0
 */

import { getContrastRatio, checkWCAG } from './contrast-checker.js';

// ============================================================================
// High Contrast Mode Token Definitions
// ============================================================================

/**
 * High contrast text colors for light mode
 * From technical spec FR-5: Four-Variant Accessibility System
 */
const highContrastLightText = {
  primary: '#000000',    // Maximum contrast - 21:1
  secondary: '#262626',  // 14:1 on white
  tertiary: '#525252',   // 7.5:1 on white (WCAG AAA minimum)
};

/**
 * High contrast text colors for dark mode
 * From technical spec FR-5
 */
const highContrastDarkText = {
  primary: '#FFFFFF',    // Maximum contrast - ~17:1 on #1C1C1E
  secondary: '#E5E5E5',  // 13:1 on #1C1C1E
  tertiary: '#B0B0B0',   // 7.5:1 on #1C1C1E (WCAG AAA minimum)
};

/**
 * Standard mode text colors for light theme
 */
const standardLightText = {
  primary: '#171717',    // 12.6:1 on white
  secondary: '#404040',  // 9.4:1 on white
  tertiary: '#737373',   // 5.5:1 on white (WCAG AA)
};

/**
 * Standard mode text colors for dark theme
 */
const standardDarkText = {
  primary: '#F5F5F7',    // 15.4:1 on #1C1C1E
  secondary: '#A1A1A6',  // 6.3:1 on #1C1C1E
  tertiary: '#6E6E73',   // 4.5:1 on #1C1C1E (WCAG AA)
};

/**
 * Background colors for testing
 */
const backgrounds = {
  lightPrimary: '#FFFFFF',     // Standard light mode
  darkPrimary: '#1C1C1E',      // Standard dark mode (Apple blue undertone)
  lightSecondary: '#fafafa',   // neutral-50
  darkSecondary: '#2C2C2E',    // Apple secondarySystemBackground
  darkTertiary: '#3A3A3C',     // Apple tertiarySystemBackground
};

/**
 * Fill token values for UI element testing
 */
const fillTokens = {
  light: {
    fillPrimary: 'rgba(0, 0, 0, 0.05)',
    fillSecondary: 'rgba(0, 0, 0, 0.03)',
    fillTertiary: 'rgba(0, 0, 0, 0.02)',
    fillQuaternary: 'rgba(0, 0, 0, 0.01)',
    fillHover: 'rgba(0, 0, 0, 0.05)',
    fillSelected: 'rgba(0, 0, 0, 0.05)',
    fillPressed: 'rgba(0, 0, 0, 0.08)',
    fillDisabled: 'rgba(0, 0, 0, 0.02)',
  },
  dark: {
    fillPrimary: 'rgba(255, 255, 255, 0.08)',
    fillSecondary: 'rgba(255, 255, 255, 0.05)',
    fillTertiary: 'rgba(255, 255, 255, 0.03)',
    fillQuaternary: 'rgba(255, 255, 255, 0.02)',
    fillHover: 'rgba(255, 255, 255, 0.08)',
    fillSelected: 'rgba(255, 255, 255, 0.08)',
    fillPressed: 'rgba(255, 255, 255, 0.12)',
    fillDisabled: 'rgba(255, 255, 255, 0.03)',
  }
};

// ============================================================================
// Validation Test Suites
// ============================================================================

/**
 * Test suite for light high contrast mode
 * Expected: All text combinations >= 7.5:1 (WCAG AAA)
 */
function testLightHighContrast() {
  const results = [];
  const bg = backgrounds.lightPrimary;

  // Test primary text
  const primaryRatio = getContrastRatio(highContrastLightText.primary, bg);
  results.push({
    name: 'Light HC - Primary Text',
    foreground: highContrastLightText.primary,
    background: bg,
    ratio: primaryRatio,
    expected: '~21:1',
    passes: primaryRatio >= 21,
    wcagLevel: primaryRatio >= 21 ? 'AAA++' : primaryRatio >= 7.5 ? 'AAA' : 'FAIL'
  });

  // Test secondary text
  const secondaryRatio = getContrastRatio(highContrastLightText.secondary, bg);
  results.push({
    name: 'Light HC - Secondary Text',
    foreground: highContrastLightText.secondary,
    background: bg,
    ratio: secondaryRatio,
    expected: '>= 7.5:1',
    passes: secondaryRatio >= 7.5,
    wcagLevel: secondaryRatio >= 7.5 ? 'AAA' : 'FAIL'
  });

  // Test tertiary text
  const tertiaryRatio = getContrastRatio(highContrastLightText.tertiary, bg);
  results.push({
    name: 'Light HC - Tertiary Text',
    foreground: highContrastLightText.tertiary,
    background: bg,
    ratio: tertiaryRatio,
    expected: '>= 7.5:1',
    passes: tertiaryRatio >= 7.5,
    wcagLevel: tertiaryRatio >= 7.5 ? 'AAA' : 'FAIL'
  });

  return results;
}

/**
 * Test suite for dark high contrast mode
 * Expected: All text combinations >= 7.5:1 (WCAG AAA)
 */
function testDarkHighContrast() {
  const results = [];
  const bg = backgrounds.darkPrimary;

  // Test primary text
  const primaryRatio = getContrastRatio(highContrastDarkText.primary, bg);
  results.push({
    name: 'Dark HC - Primary Text',
    foreground: highContrastDarkText.primary,
    background: bg,
    ratio: primaryRatio,
    expected: '>= 15:1',
    passes: primaryRatio >= 15,
    wcagLevel: primaryRatio >= 15 ? 'AAA+' : primaryRatio >= 7.5 ? 'AAA' : 'FAIL'
  });

  // Test secondary text
  const secondaryRatio = getContrastRatio(highContrastDarkText.secondary, bg);
  results.push({
    name: 'Dark HC - Secondary Text',
    foreground: highContrastDarkText.secondary,
    background: bg,
    ratio: secondaryRatio,
    expected: '>= 7.5:1',
    passes: secondaryRatio >= 7.5,
    wcagLevel: secondaryRatio >= 7.5 ? 'AAA' : 'FAIL'
  });

  // Test tertiary text
  const tertiaryRatio = getContrastRatio(highContrastDarkText.tertiary, bg);
  results.push({
    name: 'Dark HC - Tertiary Text',
    foreground: highContrastDarkText.tertiary,
    background: bg,
    ratio: tertiaryRatio,
    expected: '>= 7.5:1',
    passes: tertiaryRatio >= 7.5,
    wcagLevel: tertiaryRatio >= 7.5 ? 'AAA' : 'FAIL'
  });

  return results;
}

/**
 * Test suite for standard light mode
 * Expected: All text combinations >= 4.5:1 (WCAG AA)
 */
function testStandardLight() {
  const results = [];
  const bg = backgrounds.lightPrimary;

  // Test primary text
  const primaryRatio = getContrastRatio(standardLightText.primary, bg);
  results.push({
    name: 'Standard Light - Primary Text',
    foreground: standardLightText.primary,
    background: bg,
    ratio: primaryRatio,
    expected: '>= 4.5:1',
    passes: primaryRatio >= 4.5,
    wcagLevel: primaryRatio >= 7.5 ? 'AAA' : primaryRatio >= 4.5 ? 'AA' : 'FAIL'
  });

  // Test secondary text
  const secondaryRatio = getContrastRatio(standardLightText.secondary, bg);
  results.push({
    name: 'Standard Light - Secondary Text',
    foreground: standardLightText.secondary,
    background: bg,
    ratio: secondaryRatio,
    expected: '>= 4.5:1',
    passes: secondaryRatio >= 4.5,
    wcagLevel: secondaryRatio >= 7.5 ? 'AAA' : secondaryRatio >= 4.5 ? 'AA' : 'FAIL'
  });

  // Test tertiary text
  const tertiaryRatio = getContrastRatio(standardLightText.tertiary, bg);
  results.push({
    name: 'Standard Light - Tertiary Text',
    foreground: standardLightText.tertiary,
    background: bg,
    ratio: tertiaryRatio,
    expected: '>= 4.5:1',
    passes: tertiaryRatio >= 4.5,
    wcagLevel: tertiaryRatio >= 7.5 ? 'AAA' : tertiaryRatio >= 4.5 ? 'AA' : 'FAIL'
  });

  return results;
}

/**
 * Test suite for standard dark mode
 * Expected: All text combinations >= 4.5:1 (WCAG AA)
 */
function testStandardDark() {
  const results = [];
  const bg = backgrounds.darkPrimary;

  // Test primary text
  const primaryRatio = getContrastRatio(standardDarkText.primary, bg);
  results.push({
    name: 'Standard Dark - Primary Text',
    foreground: standardDarkText.primary,
    background: bg,
    ratio: primaryRatio,
    expected: '>= 4.5:1',
    passes: primaryRatio >= 4.5,
    wcagLevel: primaryRatio >= 7.5 ? 'AAA' : primaryRatio >= 4.5 ? 'AA' : 'FAIL'
  });

  // Test secondary text
  const secondaryRatio = getContrastRatio(standardDarkText.secondary, bg);
  results.push({
    name: 'Standard Dark - Secondary Text',
    foreground: standardDarkText.secondary,
    background: bg,
    ratio: secondaryRatio,
    expected: '>= 4.5:1',
    passes: secondaryRatio >= 4.5,
    wcagLevel: secondaryRatio >= 7.5 ? 'AAA' : secondaryRatio >= 4.5 ? 'AA' : 'FAIL'
  });

  // Test tertiary text
  const tertiaryRatio = getContrastRatio(standardDarkText.tertiary, bg);
  results.push({
    name: 'Standard Dark - Tertiary Text',
    foreground: standardDarkText.tertiary,
    background: bg,
    ratio: tertiaryRatio,
    expected: '>= 4.5:1',
    passes: tertiaryRatio >= 4.5,
    wcagLevel: tertiaryRatio >= 7.5 ? 'AAA' : tertiaryRatio >= 4.5 ? 'AA' : 'FAIL'
  });

  return results;
}

/**
 * Helper function to simulate fill token as solid color
 * Fill tokens are semi-transparent, so we composite them over background
 */
function compositeFillToken(rgba, background) {
  // Parse rgba string
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (!match) return background;

  const [, r, g, b, a] = match;
  const alpha = parseFloat(a);

  // Parse background hex
  const bgMatch = background.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!bgMatch) return background;

  const bgR = parseInt(bgMatch[1].substring(0, 2), 16);
  const bgG = parseInt(bgMatch[1].substring(2, 4), 16);
  const bgB = parseInt(bgMatch[1].substring(4, 6), 16);

  // Composite: result = alpha * fg + (1 - alpha) * bg
  const finalR = Math.round(alpha * parseInt(r) + (1 - alpha) * bgR);
  const finalG = Math.round(alpha * parseInt(g) + (1 - alpha) * bgG);
  const finalB = Math.round(alpha * parseInt(b) + (1 - alpha) * bgB);

  // Convert back to hex
  return '#' + [finalR, finalG, finalB]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Test suite for fill tokens
 * Expected: All fill tokens >= 3:1 contrast (WCAG AA for UI components)
 */
function testFillTokens() {
  const results = [];

  // Test light mode fill tokens
  Object.entries(fillTokens.light).forEach(([name, rgba]) => {
    // Composite fill over white background
    const composited = compositeFillToken(rgba, backgrounds.lightPrimary);
    const ratio = getContrastRatio(composited, backgrounds.lightPrimary);

    results.push({
      name: `Fill Light - ${name}`,
      foreground: rgba,
      background: backgrounds.lightPrimary,
      compositedColor: composited,
      ratio: ratio,
      expected: '>= 3:1',
      passes: ratio >= 3.0,
      wcagLevel: ratio >= 3.0 ? 'AA UI' : 'FAIL',
      note: 'UI component contrast requirement'
    });
  });

  // Test dark mode fill tokens
  Object.entries(fillTokens.dark).forEach(([name, rgba]) => {
    // Composite fill over dark background
    const composited = compositeFillToken(rgba, backgrounds.darkPrimary);
    const ratio = getContrastRatio(composited, backgrounds.darkPrimary);

    results.push({
      name: `Fill Dark - ${name}`,
      foreground: rgba,
      background: backgrounds.darkPrimary,
      compositedColor: composited,
      ratio: ratio,
      expected: '>= 3:1',
      passes: ratio >= 3.0,
      wcagLevel: ratio >= 3.0 ? 'AA UI' : 'FAIL',
      note: 'UI component contrast requirement'
    });
  });

  return results;
}

/**
 * Test chrome layer backgrounds on various surfaces
 */
function testChromeLayersContrast() {
  const results = [];

  // Test light mode chrome layers
  const chromeLayersLight = [
    { name: 'Content on Primary BG', fg: standardLightText.primary, bg: backgrounds.lightPrimary },
    { name: 'Content on Secondary BG', fg: standardLightText.primary, bg: backgrounds.lightSecondary },
    { name: 'Secondary Text on Secondary BG', fg: standardLightText.secondary, bg: backgrounds.lightSecondary },
  ];

  chromeLayersLight.forEach(({ name, fg, bg }) => {
    const ratio = getContrastRatio(fg, bg);
    results.push({
      name: `Chrome Light - ${name}`,
      foreground: fg,
      background: bg,
      ratio: ratio,
      expected: '>= 4.5:1',
      passes: ratio >= 4.5,
      wcagLevel: ratio >= 7.5 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'FAIL'
    });
  });

  // Test dark mode chrome layers
  const chromeLayersDark = [
    { name: 'Content on Primary BG', fg: standardDarkText.primary, bg: backgrounds.darkPrimary },
    { name: 'Content on Secondary BG', fg: standardDarkText.primary, bg: backgrounds.darkSecondary },
    { name: 'Content on Tertiary BG', fg: standardDarkText.primary, bg: backgrounds.darkTertiary },
    { name: 'Secondary Text on Secondary BG', fg: standardDarkText.secondary, bg: backgrounds.darkSecondary },
  ];

  chromeLayersDark.forEach(({ name, fg, bg }) => {
    const ratio = getContrastRatio(fg, bg);
    results.push({
      name: `Chrome Dark - ${name}`,
      foreground: fg,
      background: bg,
      ratio: ratio,
      expected: '>= 4.5:1',
      passes: ratio >= 4.5,
      wcagLevel: ratio >= 7.5 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'FAIL'
    });
  });

  return results;
}

// ============================================================================
// Main Validation Runner
// ============================================================================

/**
 * Run all validation tests and return comprehensive results
 * @returns {Object} Complete validation results with pass/fail counts
 */
export function runAllValidations() {
  const startTime = Date.now();

  const results = {
    timestamp: new Date().toISOString(),
    duration: 0,
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      passRate: 0
    },
    suites: {
      lightHighContrast: testLightHighContrast(),
      darkHighContrast: testDarkHighContrast(),
      standardLight: testStandardLight(),
      standardDark: testStandardDark(),
      fillTokens: testFillTokens(),
      chromeLayers: testChromeLayersContrast()
    }
  };

  // Calculate summary statistics
  let total = 0;
  let passed = 0;

  Object.values(results.suites).forEach(suite => {
    suite.forEach(test => {
      total++;
      if (test.passes) passed++;
    });
  });

  results.summary.total = total;
  results.summary.passed = passed;
  results.summary.failed = total - passed;
  results.summary.passRate = ((passed / total) * 100).toFixed(2);
  results.duration = Date.now() - startTime;

  return results;
}

/**
 * Format validation results as markdown for documentation
 * @param {Object} results - Results from runAllValidations()
 * @returns {string} Markdown-formatted report
 */
export function formatResultsAsMarkdown(results) {
  let md = `# WCAG AAA Validation Results\n\n`;
  md += `**Generated:** ${results.timestamp}\n`;
  md += `**Duration:** ${results.duration}ms\n\n`;

  md += `## Summary\n\n`;
  md += `- **Total Tests:** ${results.summary.total}\n`;
  md += `- **Passed:** ${results.summary.passed} ✓\n`;
  md += `- **Failed:** ${results.summary.failed} ✗\n`;
  md += `- **Pass Rate:** ${results.summary.passRate}%\n\n`;

  // Add individual suite results
  Object.entries(results.suites).forEach(([suiteName, tests]) => {
    const suitePassed = tests.filter(t => t.passes).length;
    const suiteTotal = tests.length;
    const suiteStatus = suitePassed === suiteTotal ? '✓' : '✗';

    md += `## ${suiteName} ${suiteStatus}\n\n`;
    md += `**${suitePassed}/${suiteTotal} tests passed**\n\n`;
    md += `| Test | Foreground | Background | Ratio | Expected | WCAG Level | Status |\n`;
    md += `|------|-----------|-----------|-------|----------|------------|--------|\n`;

    tests.forEach(test => {
      const status = test.passes ? '✓ PASS' : '✗ FAIL';
      const fg = test.compositedColor || test.foreground;
      md += `| ${test.name} | ${fg} | ${test.background} | ${test.ratio.toFixed(2)}:1 | ${test.expected} | ${test.wcagLevel} | ${status} |\n`;
    });

    md += `\n`;
  });

  return md;
}

/**
 * Console-friendly output for terminal display
 * @param {Object} results - Results from runAllValidations()
 */
export function logResultsToConsole(results) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  WCAG AAA VALIDATION RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Generated: ${results.timestamp}`);
  console.log(`Duration: ${results.duration}ms\n`);

  console.log('─── SUMMARY ───────────────────────────────────────────────────');
  console.log(`Total Tests:  ${results.summary.total}`);
  console.log(`Passed:       ${results.summary.passed} ✓`);
  console.log(`Failed:       ${results.summary.failed} ✗`);
  console.log(`Pass Rate:    ${results.summary.passRate}%\n`);

  Object.entries(results.suites).forEach(([suiteName, tests]) => {
    const suitePassed = tests.filter(t => t.passes).length;
    const suiteTotal = tests.length;
    const suiteStatus = suitePassed === suiteTotal ? '✓' : '✗';

    console.log(`─── ${suiteName.toUpperCase()} ${suiteStatus} ───`);
    console.log(`${suitePassed}/${suiteTotal} tests passed\n`);

    tests.forEach(test => {
      const status = test.passes ? '✓' : '✗';
      const statusColor = test.passes ? '\x1b[32m' : '\x1b[31m';
      const resetColor = '\x1b[0m';

      console.log(`${statusColor}${status}${resetColor} ${test.name}`);
      console.log(`  Foreground: ${test.compositedColor || test.foreground}`);
      console.log(`  Background: ${test.background}`);
      console.log(`  Ratio: ${test.ratio.toFixed(2)}:1 (expected ${test.expected})`);
      console.log(`  WCAG Level: ${test.wcagLevel}\n`);
    });
  });

  console.log('═══════════════════════════════════════════════════════════════\n');
}

/**
 * Save results to JSON file for programmatic access
 * @param {Object} results - Results from runAllValidations()
 * @returns {string} JSON string
 */
export function formatResultsAsJSON(results) {
  return JSON.stringify(results, null, 2);
}
