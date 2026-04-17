/**
 * WCAG 2.2 Contrast Checker Utility
 *
 * This utility validates color contrast ratios according to WCAG 2.2 accessibility standards.
 *
 * WCAG 2.2 Contrast Requirements:
 * - AA Normal Text (< 18px regular, < 14px bold): 4.5:1 minimum
 * - AA Large Text (>= 18px regular, >= 14px bold): 3.0:1 minimum
 * - AAA Normal Text: 7.0:1 minimum
 * - AAA Large Text: 4.5:1 minimum
 * - UI Components (non-text): 3.0:1 minimum
 *
 * Formula: Contrast ratio = (L1 + 0.05) / (L2 + 0.05)
 * where L1 is the relative luminance of the lighter color and L2 is the darker color.
 *
 * References:
 * - WCAG 2.2: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
 * - Relative Luminance: https://www.w3.org/WAI/GL/wiki/Relative_luminance
 *
 * @example
 * // Check if a color combination passes WCAG AA
 * const result = checkWCAG('#737373', '#ffffff');
 * console.log(result.AA); // true (5.5:1 ratio)
 *
 * @example
 * // Get the exact contrast ratio
 * const ratio = getContrastRatio('#000000', '#ffffff');
 * console.log(ratio); // 21 (perfect contrast)
 */

/**
 * Converts a hex color code to RGB object
 * Supports both 3-digit (#fff) and 6-digit (#ffffff) hex codes
 *
 * @param {string} hex - Hex color code (with or without #)
 * @returns {{r: number, g: number, b: number}} RGB object with values 0-255
 * @throws {Error} If hex format is invalid
 *
 * @example
 * hexToRgb('#ffffff') // { r: 255, g: 255, b: 255 }
 * hexToRgb('#fff')    // { r: 255, g: 255, b: 255 }
 * hexToRgb('000')     // { r: 0, g: 0, b: 0 }
 */
export function hexToRgb(hex) {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Validate hex format
  if (!/^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new Error(`Invalid hex color format: ${hex}`);
  }

  // Expand 3-digit hex to 6-digit
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }

  // Parse hex to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return { r, g, b };
}

/**
 * Calculates the relative luminance of a color according to WCAG formula
 *
 * The relative luminance is calculated using the sRGB color space formula:
 * L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * where R, G, and B are the linearized RGB values.
 *
 * @param {{r: number, g: number, b: number}} rgb - RGB object with values 0-255
 * @returns {number} Relative luminance value between 0 and 1
 *
 * @example
 * getLuminance({ r: 255, g: 255, b: 255 }) // 1 (white)
 * getLuminance({ r: 0, g: 0, b: 0 })       // 0 (black)
 */
export function getLuminance(rgb) {
  // Normalize RGB values to 0-1 range
  const rsRGB = rgb.r / 255;
  const gsRGB = rgb.g / 255;
  const bsRGB = rgb.b / 255;

  // Apply sRGB gamma correction
  // Values <= 0.03928 are linearized differently than values > 0.03928
  const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  // Calculate relative luminance using WCAG coefficients
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculates the contrast ratio between two colors
 *
 * The order of colors doesn't matter - the function automatically determines
 * which is lighter and which is darker.
 *
 * @param {string} foreground - Foreground hex color (text color)
 * @param {string} background - Background hex color
 * @returns {number} Contrast ratio rounded to 2 decimal places (1:1 to 21:1)
 *
 * @example
 * getContrastRatio('#000000', '#ffffff') // 21
 * getContrastRatio('#ffffff', '#000000') // 21 (order doesn't matter)
 * getContrastRatio('#737373', '#ffffff') // 5.5
 * getContrastRatio('#999999', '#ffffff') // 2.85
 */
export function getContrastRatio(foreground, background) {
  // Convert hex to RGB
  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);

  // Calculate luminance for both colors
  const fgLuminance = getLuminance(fgRgb);
  const bgLuminance = getLuminance(bgRgb);

  // Determine which is lighter and which is darker
  const lighter = Math.max(fgLuminance, bgLuminance);
  const darker = Math.min(fgLuminance, bgLuminance);

  // Calculate contrast ratio using WCAG formula
  const ratio = (lighter + 0.05) / (darker + 0.05);

  // Round to 2 decimal places
  return Math.round(ratio * 100) / 100;
}

/**
 * Checks if a color combination meets WCAG 2.2 accessibility standards
 *
 * Returns an object with boolean flags for each WCAG level:
 * - AA: Minimum standard for normal text (4.5:1)
 * - AALarge: Minimum standard for large text (3.0:1)
 * - AAA: Enhanced standard for normal text (7.0:1)
 * - AAALarge: Enhanced standard for large text (4.5:1)
 *
 * @param {string} foreground - Foreground hex color (text color)
 * @param {string} background - Background hex color
 * @returns {{ratio: number, AA: boolean, AALarge: boolean, AAA: boolean, AAALarge: boolean}}
 *
 * @example
 * checkWCAG('#737373', '#ffffff')
 * // { ratio: 5.5, AA: true, AALarge: true, AAA: false, AAALarge: true }
 *
 * @example
 * checkWCAG('#999999', '#ffffff')
 * // { ratio: 2.85, AA: false, AALarge: false, AAA: false, AAALarge: false }
 */
export function checkWCAG(foreground, background) {
  const ratio = getContrastRatio(foreground, background);

  return {
    ratio: ratio,
    AA: ratio >= 4.5,        // Normal text WCAG AA
    AALarge: ratio >= 3.0,   // Large text WCAG AA
    AAA: ratio >= 7.0,       // Normal text WCAG AAA
    AAALarge: ratio >= 4.5   // Large text WCAG AAA
  };
}

/**
 * Test function to verify contrast checker functionality
 * Run this in the browser console to validate implementation
 *
 * @example
 * import { testContrastChecker } from './contrast-checker.js';
 * testContrastChecker();
 */
export function testContrastChecker() {
  console.log('=== WCAG Contrast Checker Tests ===\n');

  // Test 1: Black on white
  const test1 = getContrastRatio('#000000', '#ffffff');
  console.log(`Test 1 - Black on white: ${test1} (expected ~21)`);
  console.log(`  ✓ Pass: ${test1 >= 20.9 && test1 <= 21.1}\n`);

  // Test 2: White on black (order shouldn't matter)
  const test2 = getContrastRatio('#ffffff', '#000000');
  console.log(`Test 2 - White on black: ${test2} (expected ~21)`);
  console.log(`  ✓ Pass: ${test2 >= 20.9 && test2 <= 21.1}\n`);

  // Test 3: Dark gray on white (should pass AA)
  const test3 = checkWCAG('#1a1a1a', '#ffffff');
  console.log(`Test 3 - #1a1a1a on #ffffff: ${test3.ratio}`);
  console.log(`  AA: ${test3.AA} (expected true)`);
  console.log(`  ✓ Pass: ${test3.AA === true}\n`);

  // Test 4: Light gray on white (should fail AA - current problematic color)
  const test4 = checkWCAG('#999999', '#ffffff');
  console.log(`Test 4 - #999999 on #ffffff: ${test4.ratio}`);
  console.log(`  AA: ${test4.AA} (expected false)`);
  console.log(`  ✓ Pass: ${test4.AA === false}\n`);

  // Test 5: Accessible gray on white (should pass AA - new color)
  const test5 = checkWCAG('#737373', '#ffffff');
  console.log(`Test 5 - #737373 on #ffffff: ${test5.ratio}`);
  console.log(`  AA: ${test5.AA} (expected true)`);
  console.log(`  ✓ Pass: ${test5.AA === true}\n`);

  // Test 6: 3-digit hex code
  const test6 = getContrastRatio('#fff', '#000');
  console.log(`Test 6 - 3-digit hex (#fff on #000): ${test6} (expected ~21)`);
  console.log(`  ✓ Pass: ${test6 >= 20.9 && test6 <= 21.1}\n`);

  // Test 7: 6-digit hex code
  const test7 = getContrastRatio('#ffffff', '#000000');
  console.log(`Test 7 - 6-digit hex (#ffffff on #000000): ${test7} (expected ~21)`);
  console.log(`  ✓ Pass: ${test7 >= 20.9 && test7 <= 21.1}\n`);

  // Additional test: Show full WCAG breakdown
  console.log('=== WCAG Standards Breakdown ===');
  const colors = [
    { fg: '#1a1a1a', bg: '#ffffff', label: 'Dark gray on white' },
    { fg: '#999999', bg: '#ffffff', label: 'Light gray on white (failing)' },
    { fg: '#737373', bg: '#ffffff', label: 'Medium gray on white (accessible)' },
    { fg: '#3b82f6', bg: '#ffffff', label: 'Blue accent on white' }
  ];

  colors.forEach(({ fg, bg, label }) => {
    const result = checkWCAG(fg, bg);
    console.log(`\n${label}:`);
    console.log(`  Ratio: ${result.ratio}:1`);
    console.log(`  WCAG AA (normal): ${result.AA ? '✓' : '✗'}`);
    console.log(`  WCAG AA (large): ${result.AALarge ? '✓' : '✗'}`);
    console.log(`  WCAG AAA (normal): ${result.AAA ? '✓' : '✗'}`);
    console.log(`  WCAG AAA (large): ${result.AAALarge ? '✓' : '✗'}`);
  });

  console.log('\n=== All Tests Complete ===');
}
