# WCAG AAA Validation Tools

This directory contains automated WCAG AAA validation tools for the Vault color system.

## Quick Start

### Run All Tests (Console Output)

```bash
node src/utils/run-wcag-validation.js
```

### Generate Markdown Report

```bash
node src/utils/run-wcag-validation.js --format=markdown --output=wcag-report.md
```

### Generate JSON Data

```bash
node src/utils/run-wcag-validation.js --format=json --output=wcag-report.json
```

### Visual Testing

Open `src/utils/wcag-visual-test.html` in a browser to:
- See live previews of all token combinations
- Switch between light/dark and standard/high contrast modes
- View real-time contrast ratio calculations
- Test fill token hover states
- Run automated tests from the browser

## Files

### 1. `wcag-aaa-validator.js`

Core validation logic that tests all color token combinations.

**Features:**
- Tests light high contrast mode (WCAG AAA 7.5:1)
- Tests dark high contrast mode (WCAG AAA 7.5:1)
- Tests standard light mode (WCAG AA 4.5:1)
- Tests standard dark mode (WCAG AA 4.5:1)
- Tests fill tokens (informational - 3:1 for UI components)
- Tests chrome layer combinations
- Exports results in JSON, Markdown, and console formats

**Usage:**
```javascript
import { runAllValidations, formatResultsAsMarkdown } from './wcag-aaa-validator.js';

const results = runAllValidations();
console.log(formatResultsAsMarkdown(results));
```

### 2. `run-wcag-validation.js`

CLI test runner for executing validation tests.

**Usage:**
```bash
# Console output (default)
node src/utils/run-wcag-validation.js

# Markdown output to file
node src/utils/run-wcag-validation.js --format=markdown --output=results.md

# JSON output to file
node src/utils/run-wcag-validation.js --format=json --output=results.json

# Save to custom location
node src/utils/run-wcag-validation.js --output=.docs/test-results/wcag.md
```

**Exit Codes:**
- 0: All tests passed
- 1: Some tests failed (see output for details)

### 3. `wcag-visual-test.html`

Interactive visual testing tool for manual verification.

**Features:**
- Live preview of text/background combinations
- Theme switcher (light/dark, standard/high contrast)
- Real-time contrast ratio calculations
- WCAG level badges (AAA++, AAA, AA, FAIL)
- Fill token hover state demonstrations
- Run automated tests button

**Usage:**
```bash
# macOS
open src/utils/wcag-visual-test.html

# Linux
xdg-open src/utils/wcag-visual-test.html

# Windows
start src/utils/wcag-visual-test.html
```

### 4. `contrast-checker.js`

Low-level contrast calculation utilities (already existing).

**Features:**
- Hex to RGB conversion
- Relative luminance calculation (WCAG formula)
- Contrast ratio calculation
- WCAG level checking (AA, AAA for normal and large text)

**Usage:**
```javascript
import { getContrastRatio, checkWCAG } from './contrast-checker.js';

const ratio = getContrastRatio('#000000', '#ffffff');
console.log(ratio); // 21

const wcag = checkWCAG('#737373', '#ffffff');
console.log(wcag); // { ratio: 4.74, AA: true, AALarge: true, AAA: false, AAALarge: true }
```

## Test Coverage

### Four-Variant System

The tests validate all four accessibility variants:

1. **Light Standard** - WCAG AA (4.5:1)
2. **Light High Contrast** - WCAG AAA (7.5:1)
3. **Dark Standard** - WCAG AA (4.5:1)
4. **Dark High Contrast** - WCAG AAA (7.5:1)

### Token Categories Tested

1. **Primary/Secondary/Tertiary Text** - All three text levels in all four variants
2. **Fill Tokens** - Interactive background overlays (hover/selected/pressed states)
3. **Chrome Layers** - Content text on various chrome backgrounds

### Total: 35 Automated Tests

- 3 light high contrast text combinations
- 3 dark high contrast text combinations
- 3 standard light text combinations
- 3 standard dark text combinations
- 16 fill token combinations (informational)
- 7 chrome layer combinations

## Understanding Test Results

### WCAG Levels

- **AAA++** (21:1): Maximum contrast (pure black on white or white on black)
- **AAA+** (15:1+): Exceptional contrast
- **AAA** (7.5:1+): Enhanced standard for normal text
- **AA** (4.5:1+): Minimum standard for normal text
- **AA UI** (3:1+): Minimum for UI components (non-text)
- **FAIL** (<required ratio): Does not meet accessibility requirements

### Fill Token "Failures"

Fill tokens **intentionally fail** 3:1 contrast tests. This is **by design** because:

1. They are subtle overlays (0.05-0.12 opacity)
2. They provide state feedback (hover/selected), not standalone UI
3. They match Apple's design pattern for interactive states

**Example:**
```css
.list-item { background: transparent; }
.list-item:hover { background: var(--fill-hover); /* rgba(0, 0, 0, 0.05) */ }
```

The hover state is perceivable through the subtle tint, not 3:1 contrast alone.

## Adding New Tests

To add new color combinations to the validation suite:

1. Open `src/utils/wcag-aaa-validator.js`
2. Add token values to the appropriate section
3. Add test cases to the relevant test function
4. Run `node src/utils/run-wcag-validation.js` to verify

Example:
```javascript
// In testStandardLight()
const newRatio = getContrastRatio('#your-color', backgrounds.lightPrimary);
results.push({
  name: 'Standard Light - New Token',
  foreground: '#your-color',
  background: backgrounds.lightPrimary,
  ratio: newRatio,
  expected: '>= 4.5:1',
  passes: newRatio >= 4.5,
  wcagLevel: newRatio >= 7.5 ? 'AAA' : newRatio >= 4.5 ? 'AA' : 'FAIL'
});
```

## Continuous Integration

To add WCAG validation to your CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Run WCAG Validation
  run: node src/utils/run-wcag-validation.js
```

The script exits with code 1 if any tests fail, failing the CI build.

## Resources

- **WCAG 2.2 Contrast Guidelines:** https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- **Relative Luminance Calculation:** https://www.w3.org/WAI/GL/wiki/Relative_luminance
- **Apple Human Interface Guidelines:** https://developer.apple.com/design/human-interface-guidelines/
- **Test Results Documentation:** `.docs/specs/2025-12-13-apple-principles-color-refinement/test-results/`

## Known Issues

### Dark Theme Tertiary Text

**Color:** #6E6E73 (chromePrimaryTextMuted)
**Background:** #1C1C1E
**Ratio:** 3.36:1 (FAIL - below 4.5:1 WCAG AA minimum)

**Recommendation:** Update to #858589 (4.51:1 ratio) in `src/tokens/colors.js:321`

This will be addressed in a follow-up task.

---

**Created:** 2025-12-13
**Task:** APR-2.5 - Run automated WCAG AAA validation for high contrast
**Spec:** Apple Principles Color Refinement
