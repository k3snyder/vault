/**
 * WCAG AA Compliance Validation Script
 *
 * This script validates all color combinations in the token system against
 * WCAG 2.2 Level AA requirements as specified in task cs-6.2.
 *
 * Run this script with: node src/utils/wcag-validation.js
 * Or import and call validateAllColors() in the browser console.
 *
 * Testing Criteria from cs-6.2:
 * 1. All text colors pass WCAG AA (4.5:1 for normal text)
 * 2. All large text passes WCAG AA (3:1 for large text)
 * 3. All UI components pass 3:1 contrast requirement
 * 4. Focus indicators are clearly visible in both themes
 *
 * @version 1.0.0
 */

import { getContrastRatio, checkWCAG } from './contrast-checker.js';
import { lightTheme, darkTheme, priorities } from '../tokens/colors.js';

/**
 * Validation results object to store all test results
 */
const validationResults = {
  passed: [],
  failed: [],
  warnings: []
};

/**
 * Helper to log and record a test result
 */
function testContrast(label, foreground, background, minRatio, theme = 'light') {
  const ratio = getContrastRatio(foreground, background);
  const result = checkWCAG(foreground, background);
  const passed = ratio >= minRatio;

  const testResult = {
    label,
    theme,
    foreground,
    background,
    ratio: ratio.toFixed(2),
    minRatio,
    passed,
    wcagAA: result.AA,
    wcagAALarge: result.AALarge
  };

  if (passed) {
    validationResults.passed.push(testResult);
  } else {
    validationResults.failed.push(testResult);
  }

  return testResult;
}

/**
 * Test all text/background combinations
 */
function testTextColors() {
  console.log('\n=== Testing Text Colors (4.5:1 minimum for WCAG AA) ===\n');

  // Light theme text colors
  console.log('LIGHT THEME:');
  testContrast('textPrimary on bgPrimary', lightTheme.textPrimary, lightTheme.bgPrimary, 4.5, 'light');
  testContrast('textSecondary on bgPrimary', lightTheme.textSecondary, lightTheme.bgPrimary, 4.5, 'light');
  testContrast('textTertiary on bgPrimary', lightTheme.textTertiary, lightTheme.bgPrimary, 4.5, 'light');
  testContrast('textPrimary on bgSecondary', lightTheme.textPrimary, lightTheme.bgSecondary, 4.5, 'light');
  testContrast('textPrimary on bgTertiary', lightTheme.textPrimary, lightTheme.bgTertiary, 4.5, 'light');
  testContrast('textSecondary on bgSecondary', lightTheme.textSecondary, lightTheme.bgSecondary, 4.5, 'light');

  // Dark theme text colors
  console.log('\nDARK THEME:');
  testContrast('textPrimary on bgPrimary', darkTheme.textPrimary, darkTheme.bgPrimary, 4.5, 'dark');
  testContrast('textSecondary on bgPrimary', darkTheme.textSecondary, darkTheme.bgPrimary, 4.5, 'dark');
  testContrast('textTertiary on bgPrimary', darkTheme.textTertiary, darkTheme.bgPrimary, 4.5, 'dark');
  testContrast('textPrimary on bgSecondary', darkTheme.textPrimary, darkTheme.bgSecondary, 4.5, 'dark');
  testContrast('textPrimary on bgTertiary', darkTheme.textPrimary, darkTheme.bgTertiary, 4.5, 'dark');
  testContrast('textSecondary on bgSecondary', darkTheme.textSecondary, darkTheme.bgSecondary, 4.5, 'dark');
}

/**
 * Test status color combinations
 */
function testStatusColors() {
  console.log('\n=== Testing Status Colors (4.5:1 minimum for text) ===\n');

  // Light theme status colors
  console.log('LIGHT THEME:');
  testContrast('successText on successBg', lightTheme.successText, lightTheme.successBg, 4.5, 'light');
  testContrast('warningText on warningBg', lightTheme.warningText, lightTheme.warningBg, 4.5, 'light');
  testContrast('errorText on errorBg', lightTheme.errorText, lightTheme.errorBg, 4.5, 'light');
  testContrast('infoText on infoBg', lightTheme.infoText, lightTheme.infoBg, 4.5, 'light');

  // Dark theme status colors
  console.log('\nDARK THEME:');
  testContrast('successText on bgPrimary', darkTheme.successText, darkTheme.bgPrimary, 4.5, 'dark');
  testContrast('warningText on bgPrimary', darkTheme.warningText, darkTheme.bgPrimary, 4.5, 'dark');
  testContrast('errorText on bgPrimary', darkTheme.errorText, darkTheme.bgPrimary, 4.5, 'dark');
  testContrast('infoText on bgPrimary', darkTheme.infoText, darkTheme.bgPrimary, 4.5, 'dark');
}

/**
 * Test priority color combinations
 */
function testPriorityColors() {
  console.log('\n=== Testing Priority Colors (4.5:1 minimum) ===\n');

  // Light theme priorities
  console.log('LIGHT THEME:');
  testContrast('priority-high text on bg', priorities.light.high.text, priorities.light.high.bg, 4.5, 'light');
  testContrast('priority-medium text on bg', priorities.light.medium.text, priorities.light.medium.bg, 4.5, 'light');
  testContrast('priority-low text on bg', priorities.light.low.text, priorities.light.low.bg, 4.5, 'light');

  // Dark theme priorities
  console.log('\nDARK THEME:');
  testContrast('priority-high text on dark bg', priorities.dark.high.text, darkTheme.bgPrimary, 4.5, 'dark');
  testContrast('priority-medium text on dark bg', priorities.dark.medium.text, darkTheme.bgPrimary, 4.5, 'dark');
  testContrast('priority-low text on dark bg', priorities.dark.low.text, darkTheme.bgPrimary, 4.5, 'dark');
}

/**
 * Test accent colors and UI components (3:1 minimum)
 */
function testAccentColors() {
  console.log('\n=== Testing Accent Colors (3:1 minimum for UI components) ===\n');

  // Light theme accents
  console.log('LIGHT THEME:');
  testContrast('accentPrimary on bgPrimary', lightTheme.accentPrimary, lightTheme.bgPrimary, 3.0, 'light');
  testContrast('linkColor on bgPrimary', lightTheme.linkColor, lightTheme.bgPrimary, 3.0, 'light');
  testContrast('wikilinkValid on bgPrimary', lightTheme.wikilinkValid, lightTheme.bgPrimary, 3.0, 'light');
  testContrast('wikilinkBroken on bgPrimary', lightTheme.wikilinkBroken, lightTheme.bgPrimary, 3.0, 'light');

  // Dark theme accents
  console.log('\nDARK THEME:');
  testContrast('accentPrimary on bgPrimary', darkTheme.accentPrimary, darkTheme.bgPrimary, 3.0, 'dark');
  testContrast('linkColor on bgPrimary', darkTheme.linkColor, darkTheme.bgPrimary, 3.0, 'dark');
  testContrast('wikilinkValid on bgPrimary', darkTheme.wikilinkValid, darkTheme.bgPrimary, 3.0, 'dark');
  testContrast('wikilinkBroken on bgPrimary', darkTheme.wikilinkBroken, darkTheme.bgPrimary, 3.0, 'dark');
}

/**
 * Test focus indicators (3:1 minimum)
 */
function testFocusIndicators() {
  console.log('\n=== Testing Focus Indicators (3:1 minimum) ===\n');

  // Light theme focus
  console.log('LIGHT THEME:');
  testContrast('focusRing on bgPrimary', lightTheme.focusRing, lightTheme.bgPrimary, 3.0, 'light');
  testContrast('borderFocus on bgPrimary', lightTheme.borderFocus, lightTheme.bgPrimary, 3.0, 'light');

  // Dark theme focus
  console.log('\nDARK THEME:');
  testContrast('focusRing on bgPrimary', darkTheme.focusRing, darkTheme.bgPrimary, 3.0, 'dark');
  testContrast('borderFocus on bgPrimary', darkTheme.borderFocus, darkTheme.bgPrimary, 3.0, 'dark');
}

/**
 * Test editor colors
 */
function testEditorColors() {
  console.log('\n=== Testing Editor Colors (4.5:1 minimum for text) ===\n');

  // Light theme editor
  console.log('LIGHT THEME:');
  testContrast('editorText on editorBg', lightTheme.editorText, lightTheme.editorBg, 4.5, 'light');
  testContrast('editorLineNumber on editorBg', lightTheme.editorLineNumber, lightTheme.editorBg, 4.5, 'light');
  testContrast('editorLineNumberActive on editorBg', lightTheme.editorLineNumberActive, lightTheme.editorBg, 4.5, 'light');

  // Dark theme editor
  console.log('\nDARK THEME:');
  testContrast('editorText on editorBg', darkTheme.editorText, darkTheme.editorBg, 4.5, 'dark');
  testContrast('editorLineNumber on editorBg', darkTheme.editorLineNumber, darkTheme.editorBg, 4.5, 'dark');
  testContrast('editorLineNumberActive on editorBg', darkTheme.editorLineNumberActive, darkTheme.editorBg, 4.5, 'dark');
}

/**
 * Test syntax highlighting colors
 */
function testSyntaxColors() {
  console.log('\n=== Testing Syntax Highlighting (3:1 minimum - UI elements) ===\n');

  // Light theme syntax
  console.log('LIGHT THEME:');
  testContrast('syntaxKeyword on editorBg', lightTheme.syntaxKeyword, lightTheme.editorBg, 3.0, 'light');
  testContrast('syntaxString on editorBg', lightTheme.syntaxString, lightTheme.editorBg, 3.0, 'light');
  testContrast('syntaxComment on editorBg', lightTheme.syntaxComment, lightTheme.editorBg, 3.0, 'light');
  testContrast('syntaxFunction on editorBg', lightTheme.syntaxFunction, lightTheme.editorBg, 3.0, 'light');

  // Dark theme syntax
  console.log('\nDARK THEME:');
  testContrast('syntaxKeyword on editorBg', darkTheme.syntaxKeyword, darkTheme.editorBg, 3.0, 'dark');
  testContrast('syntaxString on editorBg', darkTheme.syntaxString, darkTheme.editorBg, 3.0, 'dark');
  testContrast('syntaxComment on editorBg', darkTheme.syntaxComment, darkTheme.editorBg, 3.0, 'dark');
  testContrast('syntaxFunction on editorBg', darkTheme.syntaxFunction, darkTheme.editorBg, 3.0, 'dark');
}

/**
 * Generate summary report
 */
function generateReport() {
  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('WCAG AA COMPLIANCE VALIDATION REPORT');
  console.log('='.repeat(80));
  console.log(`\nTotal Tests: ${validationResults.passed.length + validationResults.failed.length}`);
  console.log(`Passed: ${validationResults.passed.length}`);
  console.log(`Failed: ${validationResults.failed.length}`);

  if (validationResults.failed.length > 0) {
    console.log('\n❌ FAILED TESTS:\n');
    validationResults.failed.forEach(test => {
      console.log(`  ${test.theme.toUpperCase()} - ${test.label}`);
      console.log(`    Foreground: ${test.foreground}`);
      console.log(`    Background: ${test.background}`);
      console.log(`    Ratio: ${test.ratio}:1 (required: ${test.minRatio}:1)`);
      console.log(`    WCAG AA: ${test.wcagAA ? '✓' : '✗'}`);
      console.log('');
    });
  }

  console.log('\n✅ WCAG AA COMPLIANCE SUMMARY:\n');

  const textTests = validationResults.passed.filter(t => t.label.includes('text') || t.label.includes('Text'));
  const accentTests = validationResults.passed.filter(t => t.label.includes('accent') || t.label.includes('link'));
  const statusTests = validationResults.passed.filter(t => t.label.includes('success') || t.label.includes('warning') || t.label.includes('error') || t.label.includes('info'));
  const priorityTests = validationResults.passed.filter(t => t.label.includes('priority'));
  const focusTests = validationResults.passed.filter(t => t.label.includes('focus'));
  const editorTests = validationResults.passed.filter(t => t.label.includes('editor'));
  const syntaxTests = validationResults.passed.filter(t => t.label.includes('syntax'));

  console.log(`  ✓ Text colors: ${textTests.length} passed`);
  console.log(`  ✓ Accent colors: ${accentTests.length} passed`);
  console.log(`  ✓ Status colors: ${statusTests.length} passed`);
  console.log(`  ✓ Priority colors: ${priorityTests.length} passed`);
  console.log(`  ✓ Focus indicators: ${focusTests.length} passed`);
  console.log(`  ✓ Editor colors: ${editorTests.length} passed`);
  console.log(`  ✓ Syntax highlighting: ${syntaxTests.length} passed`);

  const allPassed = validationResults.failed.length === 0;

  console.log('\n' + '='.repeat(80));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED - WCAG AA COMPLIANT');
  } else {
    console.log('❌ SOME TESTS FAILED - REQUIRES ATTENTION');
  }
  console.log('='.repeat(80) + '\n');

  return {
    totalTests: validationResults.passed.length + validationResults.failed.length,
    passed: validationResults.passed.length,
    failed: validationResults.failed.length,
    allPassed,
    details: validationResults
  };
}

/**
 * Main validation function - runs all tests
 */
export function validateAllColors() {
  console.log('Starting WCAG AA Compliance Validation...\n');
  console.log('Testing all color combinations from token system');
  console.log('Reference: WCAG 2.2 Level AA Standards\n');

  // Run all test suites
  testTextColors();
  testStatusColors();
  testPriorityColors();
  testAccentColors();
  testFocusIndicators();
  testEditorColors();
  testSyntaxColors();

  // Generate and return report
  return generateReport();
}

/**
 * Generate documentation of all contrast ratios
 */
export function documentContrastRatios() {
  console.log('\n=== CONTRAST RATIO DOCUMENTATION ===\n');
  console.log('This document records all contrast ratios for future reference.\n');

  const documentation = {
    lightTheme: {},
    darkTheme: {},
    generatedAt: new Date().toISOString()
  };

  // Document light theme
  documentation.lightTheme = {
    text: {
      'textPrimary on bgPrimary': getContrastRatio(lightTheme.textPrimary, lightTheme.bgPrimary),
      'textSecondary on bgPrimary': getContrastRatio(lightTheme.textSecondary, lightTheme.bgPrimary),
      'textTertiary on bgPrimary': getContrastRatio(lightTheme.textTertiary, lightTheme.bgPrimary)
    },
    accents: {
      'accentPrimary on bgPrimary': getContrastRatio(lightTheme.accentPrimary, lightTheme.bgPrimary),
      'linkColor on bgPrimary': getContrastRatio(lightTheme.linkColor, lightTheme.bgPrimary)
    },
    status: {
      'successText on successBg': getContrastRatio(lightTheme.successText, lightTheme.successBg),
      'warningText on warningBg': getContrastRatio(lightTheme.warningText, lightTheme.warningBg),
      'errorText on errorBg': getContrastRatio(lightTheme.errorText, lightTheme.errorBg),
      'infoText on infoBg': getContrastRatio(lightTheme.infoText, lightTheme.infoBg)
    }
  };

  // Document dark theme
  documentation.darkTheme = {
    text: {
      'textPrimary on bgPrimary': getContrastRatio(darkTheme.textPrimary, darkTheme.bgPrimary),
      'textSecondary on bgPrimary': getContrastRatio(darkTheme.textSecondary, darkTheme.bgPrimary),
      'textTertiary on bgPrimary': getContrastRatio(darkTheme.textTertiary, darkTheme.bgPrimary)
    },
    accents: {
      'accentPrimary on bgPrimary': getContrastRatio(darkTheme.accentPrimary, darkTheme.bgPrimary),
      'linkColor on bgPrimary': getContrastRatio(darkTheme.linkColor, darkTheme.bgPrimary)
    },
    status: {
      'successText on bgPrimary': getContrastRatio(darkTheme.successText, darkTheme.bgPrimary),
      'warningText on bgPrimary': getContrastRatio(darkTheme.warningText, darkTheme.bgPrimary),
      'errorText on bgPrimary': getContrastRatio(darkTheme.errorText, darkTheme.bgPrimary),
      'infoText on bgPrimary': getContrastRatio(darkTheme.infoText, darkTheme.bgPrimary)
    }
  };

  console.log(JSON.stringify(documentation, null, 2));

  return documentation;
}

// If running in Node.js (not browser), execute validation
if (typeof window === 'undefined') {
  validateAllColors();
}
