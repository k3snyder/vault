# Design Token System

> Version: 1.0.0
> Created: 2025-12-13

The Vault design token system provides a centralized, semantic color system that ensures visual consistency, accessibility compliance, and full light/dark theme support across the entire application.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Quick Start](#quick-start)
- [Using Tokens in Components](#using-tokens-in-components)
- [Token Naming Conventions](#token-naming-conventions)
- [Adding New Colors](#adding-new-colors)
- [Theme Customization](#theme-customization)
- [Accessibility Guidelines](#accessibility-guidelines)
- [Migration Guide](#migration-guide)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The token system uses a **three-layer architecture** that separates concerns and provides maximum flexibility:

### Layer 1: Color Scales

Base color palettes with 10-11 steps (50, 100, 200...950), defined in `colors.js`:

```javascript
// Neutral scale (grays)
neutral: { 50: '#fafafa', ..., 950: '#0a0a0a' }

// Primary scale (blue - NOT purple)
primary: { 50: '#eff6ff', ..., 950: '#172554' }

// Status scales
success: { ... }  // Green
warning: { ... }  // Amber
error: { ... }    // Red
info: { ... }     // Blue (matches primary)
```

**Purpose:** Raw color values that rarely change. Think of these as your color palette.

### Layer 2: Semantic Tokens

Purpose-driven tokens that reference Layer 1, defined in `colors.js` as `lightTheme` and `darkTheme`:

```javascript
lightTheme: {
  bgPrimary: '#ffffff',
  textPrimary: neutral[900],
  accentPrimary: primary[600],
  // ... semantic meanings
}

darkTheme: {
  bgPrimary: neutral[950],
  textPrimary: neutral[50],
  accentPrimary: primary[500],
  // ... inverted for dark mode
}
```

**Purpose:** Tokens describe **what** something is used for, not **how** it looks. Use `bgPrimary`, not `grayLight`.

### Layer 3: CSS Variables

CSS custom properties defined in `variables.css` and consumed by components:

```css
:root {
  --bg-primary: #ffffff;
  --text-primary: var(--neutral-900);
  --accent-primary: var(--primary-600);
}

[data-theme="dark"] {
  --bg-primary: var(--neutral-950);
  --text-primary: var(--neutral-50);
  --accent-primary: var(--primary-500);
}
```

**Purpose:** What components actually use via `var(--token-name)`.

### Why Three Layers?

- **Separation of concerns:** Raw colors → Semantic meaning → Component usage
- **Easy theming:** Change semantic mappings without touching components
- **Scalability:** Add new themes without duplicating color definitions
- **Type safety:** JavaScript tokens can be validated, CSS variables consumed

---

## Quick Start

### 1. Using Tokens in CSS

Reference semantic tokens via CSS variables:

```css
.my-component {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-primary);
}

.my-button {
  background-color: var(--accent-primary);
  color: var(--text-inverse);
}

.my-button:hover {
  background-color: var(--accent-hover);
}
```

### 2. Applying Themes in JavaScript

Use the `applyTheme()` utility:

```javascript
import { applyTheme, getSystemTheme } from './tokens/css-generator.js';

// Apply a specific theme
applyTheme('dark');
applyTheme('light');

// Or detect system preference
const systemTheme = getSystemTheme();
applyTheme(systemTheme);
```

### 3. Watching for System Theme Changes

```javascript
import { watchSystemTheme, applyTheme } from './tokens/css-generator.js';

const cleanup = watchSystemTheme((newTheme) => {
  console.log('System theme changed to:', newTheme);
  applyTheme(newTheme);
});

// Clean up when component unmounts
cleanup();
```

---

## Using Tokens in Components

### CSS Files

Always import `variables.css` at the top of your CSS files (if not already imported globally):

```css
@import '../tokens/variables.css';

.widget-sidebar {
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-primary);
  padding: 16px;
}

.widget-item {
  color: var(--text-primary);
  padding: 8px;
}

.widget-item:hover {
  background-color: var(--bg-hover);
}
```

### JavaScript (Inline Styles)

Import tokens from `colors.js`:

```javascript
import { lightTheme, darkTheme } from './tokens/colors.js';

// Determine which theme to use
const theme = document.documentElement.getAttribute('data-theme') === 'dark'
  ? darkTheme
  : lightTheme;

element.style.backgroundColor = theme.bgPrimary;
element.style.color = theme.textPrimary;
```

**Best Practice:** Prefer CSS variables over inline JavaScript styles when possible. CSS variables automatically update when themes switch, while inline styles require manual updates.

### CodeMirror Extensions

For CodeMirror styling, use CSS variables in the theme configuration:

```javascript
EditorView.theme({
  '.cm-content': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-text)'
  },
  '.cm-line': {
    color: 'var(--editor-text)'
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--editor-cursor)'
  }
})
```

---

## Token Naming Conventions

### Background Tokens

- `--bg-primary` - Main content background (white in light, near-black in dark)
- `--bg-secondary` - Secondary surfaces like sidebars, panels
- `--bg-tertiary` - Tertiary surfaces, nested panels
- `--bg-elevated` - Elevated surfaces like modals, dropdowns
- `--bg-hover` - Hover state background
- `--bg-active` - Active/pressed state background

### Text Tokens

- `--text-primary` - Primary body text (highest contrast)
- `--text-secondary` - Secondary/helper text (medium contrast)
- `--text-tertiary` - Muted/placeholder text (minimum 4.5:1 contrast)
- `--text-disabled` - Disabled state text (can be below 4.5:1)
- `--text-inverse` - Text on colored backgrounds

### Border Tokens

- `--border-primary` - Default borders and dividers
- `--border-secondary` - Subtle dividers
- `--border-focus` - Focus ring color (accessibility critical)

### Accent Tokens

- `--accent-primary` - Primary interactive elements (buttons, links)
- `--accent-hover` - Hover state for interactive elements
- `--accent-active` - Active/pressed state
- `--accent-bg` - Subtle accent background tint

### Status Tokens

Each status has three variants (text, bg, border):

```css
--success-text, --success-bg, --success-border  /* Green */
--warning-text, --warning-bg, --warning-border  /* Amber */
--error-text, --error-bg, --error-border        /* Red */
--info-text, --info-bg, --info-border           /* Blue */
```

### Editor Tokens

- `--editor-bg`, `--editor-text` - Editor background and text
- `--editor-selection` - Text selection background
- `--editor-cursor` - Cursor color
- `--editor-line-number` - Line number color in gutter
- `--editor-active-line` - Active line highlight

### Syntax Highlighting Tokens

```css
--syntax-keyword      /* Keywords (if, for, function) */
--syntax-string       /* String literals */
--syntax-number       /* Numeric literals */
--syntax-comment      /* Code comments */
--syntax-function     /* Function names */
--syntax-variable     /* Variable names */
--syntax-type         /* Type definitions */
--syntax-operator     /* Operators (+, -, ==) */
--syntax-punctuation  /* Punctuation (;, ,, .) */
```

### Special Purpose Tokens

```css
--focus-ring          /* Keyboard focus indicator */
--shadow-sm, --shadow-md, --shadow-lg  /* Drop shadows */
--link-color, --link-hover, --link-visited  /* Hyperlinks */
--wikilink-valid, --wikilink-broken  /* WikiLink states */
```

---

## Adding New Colors

### When to Add a New Token

**Do add a token when:**
- The color serves a distinct semantic purpose
- The color will be reused across multiple components
- The color needs different values in light vs. dark themes

**Don't add a token when:**
- The color is component-specific and won't be reused
- You can use an existing semantic token
- The color is purely decorative

### How to Add a New Semantic Token

#### Step 1: Add to JavaScript token files

Edit `src/tokens/colors.js`:

```javascript
export const lightTheme = {
  // ... existing tokens
  myNewToken: primary[600],  // Map to a scale color
};

export const darkTheme = {
  // ... existing tokens
  myNewToken: primary[400],  // Usually different in dark theme
};
```

#### Step 2: Add to CSS variables

Edit `src/tokens/variables.css`:

```css
:root {
  /* ... existing variables */
  --my-new-token: var(--primary-600);
}

[data-theme="dark"] {
  /* ... existing variables */
  --my-new-token: var(--primary-400);
}
```

#### Step 3: Document the token

Add to this README under [Token Naming Conventions](#token-naming-conventions).

#### Step 4: Use the token

```css
.my-component {
  color: var(--my-new-token);
}
```

### Adding a New Color Scale

Only add new scales for truly distinct color families. Current scales (neutral, primary, success, warning, error, info) cover most use cases.

If you must add a scale:

1. Define the scale in `colors.js`:
```javascript
export const purple = {
  50: '#faf5ff',
  100: '#f3e8ff',
  // ... 200-900
  950: '#3b0764'
};
```

2. Create semantic tokens that reference it:
```javascript
export const lightTheme = {
  // ...
  purpleAccent: purple[600]
};
```

3. Add CSS variables in `variables.css`:
```css
:root {
  --purple-accent: var(--purple-600);
}
```

**Warning:** Every new scale adds ~11 color definitions. Use sparingly.

---

## Theme Customization

### Creating a Custom Theme

You can define custom themes by creating new semantic token mappings:

```javascript
// src/tokens/colors.js
export const highContrastTheme = {
  bgPrimary: '#ffffff',
  textPrimary: '#000000',  // Pure black for maximum contrast
  textSecondary: neutral[800],
  textTertiary: neutral[700],
  accentPrimary: primary[800],  // Darker blue for better contrast
  // ... map all semantic tokens
};
```

Then apply it:

```javascript
import { highContrastTheme } from './tokens/colors.js';
import { kebabCase } from './tokens/css-generator.js';

function applyCustomTheme(theme) {
  const root = document.documentElement;
  Object.entries(theme).forEach(([key, value]) => {
    root.style.setProperty(`--${kebabCase(key)}`, value);
  });
  root.setAttribute('data-theme', 'custom');
}

applyCustomTheme(highContrastTheme);
```

### Persisting Theme Preference

Use localStorage to remember user's theme choice:

```javascript
import { applyTheme, getSystemTheme } from './tokens/css-generator.js';

// Load saved theme or use system preference
function loadTheme() {
  const saved = localStorage.getItem('theme');
  const theme = saved || getSystemTheme();
  applyTheme(theme);
  return theme;
}

// Save theme preference
function saveTheme(theme) {
  localStorage.setItem('theme', theme);
  applyTheme(theme);
}

// Initialize
const currentTheme = loadTheme();
```

---

## Accessibility Guidelines

### WCAG 2.2 Level AA Requirements

All text colors in this system **must** meet these contrast ratios:

- **Normal text** (< 18px): **4.5:1** minimum contrast
- **Large text** (>= 18px or bold >= 14px): **3:1** minimum contrast
- **UI components** (borders, icons): **3:1** minimum contrast against adjacent colors

### Checking Contrast Ratios

Use the built-in contrast checker utility:

```javascript
import { checkWCAG } from '../utils/contrast-checker.js';

const result = checkWCAG('#1a1a1a', '#ffffff');
console.log(result);
// {
//   ratio: 16.1,
//   AA: true,      // Passes WCAG AA (4.5:1)
//   AALarge: true, // Passes WCAG AA Large (3:1)
//   AAA: true,     // Passes WCAG AAA (7:1)
//   AAALarge: true // Passes WCAG AAA Large (4.5:1)
// }
```

### Accessible Color Combinations

**Safe text/background pairs:**

```css
/* Light theme */
--text-primary on --bg-primary     ✓ 16.1:1
--text-secondary on --bg-primary   ✓ 7.5:1
--text-tertiary on --bg-primary    ✓ 5.5:1  (was 2.8:1 before fix)

/* Dark theme */
--text-primary on --bg-primary     ✓ 18.5:1
--text-secondary on --bg-primary   ✓ 8.2:1
--text-tertiary on --bg-primary    ✓ 5.1:1
```

### Using Status Colors Safely

Status colors must not rely on color alone. Always include text or icons:

```html
<!-- BAD: Color only -->
<div class="status" style="color: var(--success-text);">
  ✓
</div>

<!-- GOOD: Color + text/icon -->
<div class="status" style="color: var(--success-text);">
  <span aria-label="Success">✓</span> Operation completed
</div>
```

### Focus Indicators

**All interactive elements must have visible focus indicators:**

```css
.button:focus {
  outline: none;  /* Remove default */
  box-shadow: 0 0 0 2px var(--focus-ring-offset), 0 0 0 4px var(--focus-ring);
}
```

This creates a 2px offset ring (matches background) and 4px colored ring that meets 3:1 contrast requirement.

### Testing Accessibility

1. **Browser DevTools:**
   - Chrome: Lighthouse (Accessibility audit)
   - Firefox: Accessibility Inspector
   - Safari: Web Inspector (Elements > Computed > Contrast)

2. **Browser Extensions:**
   - axe DevTools (Chrome/Firefox)
   - WAVE (Web Accessibility Evaluation Tool)

3. **Screen Readers:**
   - macOS: VoiceOver (Cmd+F5)
   - Windows: NVDA (free), JAWS (commercial)
   - Linux: Orca

---

## Migration Guide

### Migrating Existing Components

Follow this checklist when migrating a component to use tokens:

#### 1. Identify Hard-Coded Colors

Search for hex codes in your CSS/JS files:

```bash
# Find all hex colors
grep -n '#[0-9a-fA-F]\{3,6\}' src/components/MyComponent.css
```

#### 2. Map to Semantic Tokens

For each hard-coded color, find the appropriate semantic token:

```css
/* BEFORE */
.header {
  background-color: #ffffff;
  color: #1a1a1a;
  border-bottom: 1px solid #e0e0e0;
}

/* AFTER */
.header {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-primary);
}
```

#### 3. Add Dark Mode Support

Test in dark mode and adjust if needed:

```css
/* Light theme uses default CSS variables */
.sidebar {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

/* No dark mode overrides needed! Variables handle it automatically */
```

#### 4. Handle Special Cases

For colors that don't map to existing tokens, evaluate:

- Can you use an existing token with slight opacity?
  ```css
  background-color: var(--accent-bg);  /* Already has opacity built-in */
  ```

- Is this truly a new semantic use case? → Add a new token (see [Adding New Colors](#adding-new-colors))

- Is this component-specific? → Keep the color local (don't add to token system)

#### 5. Validate Contrast

Run accessibility checks:

```javascript
import { checkWCAG } from '../utils/contrast-checker.js';

// Check your text/background combinations
const result = checkWCAG(textColor, bgColor);
if (!result.AA) {
  console.error('Contrast failure:', result.ratio);
}
```

#### 6. Test Theme Switching

1. Build and run: `npm run tauri dev`
2. Test component in light theme
3. Switch to dark theme (via settings)
4. Verify no visual regressions
5. Test hover/active/focus states in both themes

### Migration Examples

#### Example 1: Simple Text Component

```css
/* BEFORE */
.note-title {
  color: #1a1a1a;
  font-size: 24px;
  font-weight: 600;
}

.note-meta {
  color: #6b6b6b;
  font-size: 14px;
}

/* AFTER */
.note-title {
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 600;
}

.note-meta {
  color: var(--text-secondary);
  font-size: 14px;
}
```

#### Example 2: Interactive Button

```css
/* BEFORE */
.button {
  background-color: #4572DE;
  color: #ffffff;
  border: none;
}

.button:hover {
  background-color: #3a5fc2;
}

.button:focus {
  outline: 2px solid #4572DE;
}

/* AFTER */
.button {
  background-color: var(--accent-primary);
  color: var(--text-inverse);
  border: none;
}

.button:hover {
  background-color: var(--accent-hover);
}

.button:focus {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus-ring-offset), 0 0 0 4px var(--focus-ring);
}
```

#### Example 3: Status Indicator

```css
/* BEFORE */
.status-badge {
  background-color: #dcfce7;
  color: #15803d;
  border: 1px solid #86efac;
}

/* AFTER */
.status-badge {
  background-color: var(--success-bg);
  color: var(--success-text);
  border: 1px solid var(--success-border);
}
```

---

## Troubleshooting

### Colors not updating when switching themes

**Problem:** Component colors don't change when toggling between light/dark themes.

**Solutions:**

1. **Check if CSS variables are used:**
   ```css
   /* ✗ Won't update */
   color: #1a1a1a;

   /* ✓ Updates automatically */
   color: var(--text-primary);
   ```

2. **Verify data-theme attribute is set:**
   ```javascript
   console.log(document.documentElement.getAttribute('data-theme'));
   // Should log 'dark' or 'light'
   ```

3. **Check if variables.css is imported:**
   ```css
   /* At top of your CSS file */
   @import '../tokens/variables.css';
   ```

4. **Clear browser cache** - CSS changes may be cached

### Contrast ratio failures

**Problem:** Accessibility tools report contrast failures.

**Solutions:**

1. **Use the contrast checker:**
   ```javascript
   import { checkWCAG } from '../utils/contrast-checker.js';
   const result = checkWCAG(yourTextColor, yourBgColor);
   console.log('Contrast ratio:', result.ratio, 'Passes AA:', result.AA);
   ```

2. **Choose darker/lighter tokens:**
   ```css
   /* If text-tertiary fails */
   color: var(--text-tertiary);  /* ✗ 4.3:1 */

   /* Use text-secondary instead */
   color: var(--text-secondary);  /* ✓ 7.5:1 */
   ```

3. **Check token definitions in variables.css** - Ensure using correct scale steps

### Syntax highlighting not working

**Problem:** Code blocks don't have syntax colors or don't change with theme.

**Solutions:**

1. **Ensure syntax tokens are applied in CodeMirror config:**
   ```javascript
   EditorView.theme({
     '.cm-keyword': { color: 'var(--syntax-keyword)' },
     '.cm-string': { color: 'var(--syntax-string)' },
     // ... other syntax tokens
   })
   ```

2. **Check for hard-coded colors in language extensions:**
   ```javascript
   // ✗ Bad - hard-coded
   { tag: tags.keyword, color: '#d73a49' }

   // ✓ Good - uses CSS variable
   { tag: tags.keyword, color: 'var(--syntax-keyword)' }
   ```

### Tokens not found / CSS variable undefined

**Problem:** Browser shows CSS variable as undefined or fallback color.

**Solutions:**

1. **Check variable name spelling:**
   ```css
   /* ✗ Typo */
   color: var(--text-primry);

   /* ✓ Correct */
   color: var(--text-primary);
   ```

2. **Verify token exists in variables.css:**
   ```bash
   grep "my-token-name" src/tokens/variables.css
   ```

3. **Check if you're using a scale color directly:**
   ```css
   /* ✗ Scale colors not exposed as CSS vars */
   color: var(--neutral-500);

   /* ✓ Use semantic token */
   color: var(--text-tertiary);
   ```

### Dark mode looks wrong

**Problem:** Dark theme has low contrast or hard-to-read text.

**Solutions:**

1. **Verify [data-theme="dark"] selector in CSS:**
   ```css
   [data-theme="dark"] {
     --text-primary: var(--neutral-50);  /* Light text */
     --bg-primary: var(--neutral-950);   /* Dark background */
   }
   ```

2. **Check for color overrides in component CSS:**
   ```css
   /* ✗ Overrides token in dark mode */
   [data-theme="dark"] .my-component {
     color: #1a1a1a;  /* Dark text on dark bg - bad! */
   }

   /* ✓ Uses token that adapts */
   .my-component {
     color: var(--text-primary);  /* Light in dark mode */
   }
   ```

3. **Test with system dark mode:**
   - macOS: System Preferences → General → Appearance → Dark
   - Windows: Settings → Personalization → Colors → Dark

### Component-specific colors break theme

**Problem:** One component has colors that don't match the theme.

**Solutions:**

1. **Find hard-coded colors in component:**
   ```bash
   grep -n '#[0-9a-fA-F]\{3,6\}' src/components/ProblematicComponent.css
   ```

2. **Replace with semantic tokens** (see [Migration Guide](#migration-guide))

3. **Check for inline styles in JS:**
   ```javascript
   // ✗ Inline style won't theme
   element.style.color = '#1a1a1a';

   // ✓ Use CSS class with token
   element.classList.add('themed-text');
   ```

---

## Adopting Apple Principles

This section guides you through migrating components to use the Apple-inspired semantic token system, including content vs chrome layers, semantic elevation, fill tokens, semantic borders, and translucency effects.

### When to Use Content vs Chrome Layer Tokens

**Decision Framework:**

Ask yourself: **"Is this element part of what the user creates/reads, or does it support that activity?"**

#### ✓ Use Content Layer Tokens When:

- Element displays user-created markdown content
- Element is the primary focus of user attention (editor, preview pane)
- User is actively typing, reading, or editing in this area
- Element should have **maximum visual prominence**

**Example:**

```css
.editor-content {
  /* Use content layer for maximum contrast */
  background: var(--content-bg);
  color: var(--content-text);
}

.markdown-preview {
  /* Preview is content too */
  background: var(--content-bg);
  color: var(--content-text);
}

.editor-selection {
  /* Selection color optimized for editor context */
  background: var(--content-selection);
}
```

#### ✓ Use Chrome Layer Tokens When:

- Element is navigation (sidebar, toolbar, menu bar)
- Element provides context/metadata (status bar, properties panel)
- Element supports the content but isn't the content itself
- Element should **defer** to content with reduced contrast

**Layer Selection:**

```css
/* Layer 1: Primary chrome - sidebars, main navigation */
.sidebar {
  background: var(--chrome-primary-bg);
  color: var(--chrome-primary-text);
  border-right: 1px solid var(--chrome-primary-border);
}

/* Layer 2: Secondary chrome - status bars, tabs, toolbars */
.status-bar {
  background: var(--chrome-secondary-bg);
  color: var(--chrome-secondary-text);
  border-top: 1px solid var(--chrome-secondary-border);
}

/* Layer 3: Tertiary chrome - dividers, subtle structural elements */
.divider {
  background: var(--chrome-tertiary);
  /* OR use border-divider for even more subtlety */
  border-bottom: 1px solid var(--border-divider);
}
```

**Key Insight:** If removing an element would make the **content harder to create/read**, it's supporting chrome. If removing it would **remove the content itself**, it's content layer.

---

### Migrating from Numeric Shadows to Semantic Elevation

**Old System:** `--shadow-sm`, `--shadow-md`, `--shadow-lg` (what do these mean?)

**New System:** Purpose-named elevation that describes **what the element does**, not how big the shadow is.

#### Migration Steps

**Step 1: Identify component purpose**

Ask: **"Why does this element need elevation?"**

- Slightly raised (button hover, card) → `--elevation-raised`
- Floating above content (dropdown, tooltip) → `--elevation-floating`
- Blocking other content (modal, dialog) → `--elevation-overlay`
- Demands immediate attention (critical alert) → `--elevation-dramatic`
- No elevation needed (content itself) → `--elevation-grounded`

**Step 2: Replace shadow tokens**

```css
/* BEFORE */
.card {
  box-shadow: var(--shadow-sm);
}

.dropdown {
  box-shadow: var(--shadow-md);
}

.modal {
  box-shadow: var(--shadow-lg);
}

/* AFTER */
.card {
  box-shadow: var(--elevation-raised);
}

.dropdown {
  box-shadow: var(--elevation-floating);
}

.modal {
  box-shadow: var(--elevation-overlay);
}
```

**Step 3: Verify dark mode intensity**

Semantic elevation automatically adjusts for dark mode (shadows ~1.5-2x stronger). Test in both themes to ensure depth is perceivable.

#### Elevation Decision Tree

```
Does element need depth?
├─ No → use --elevation-grounded (none)
└─ Yes → How far above base surface?
    ├─ Just barely lifted (2-4px equivalent)
    │   → --elevation-raised
    │   Examples: buttons on hover, cards
    │
    ├─ Clearly floating (8-16px equivalent)
    │   → --elevation-floating
    │   Examples: dropdowns, popovers, tooltips
    │
    ├─ Blocks other content (32-64px equivalent)
    │   → --elevation-overlay
    │   Examples: modals, dialogs, command palette
    │
    └─ Demands immediate attention (128px+ equivalent)
        → --elevation-dramatic
        Examples: onboarding spotlights, critical alerts
```

**Common Mistake:** Using elevation for importance instead of physical distance. A critical error message might use `--elevation-overlay` (if it's a modal), not `--elevation-dramatic` just because it's important.

---

### Migrating from Hard-Coded RGBA Hover States to Fill Tokens

**Problem:** Components have inconsistent hover states with hard-coded rgba values.

```css
/* Inconsistent hard-coded hover states */
.list-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.button:hover {
  background: rgba(0, 0, 0, 0.08);
}

.menu-item:hover {
  background: rgba(200, 200, 200, 0.1);
}
```

**Solution:** Use Apple's four-level fill token system for **consistent interaction states** across all components.

#### Migration Steps

**Step 1: Identify interaction states**

Categorize each state:
- **Hover** → `--fill-hover`
- **Active/Pressed** → `--fill-pressed`
- **Selected** → `--fill-selected`
- **Disabled** → `--fill-disabled`

**Step 2: Replace hard-coded rgba**

```css
/* BEFORE */
.list-item {
  background: transparent;
}

.list-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.list-item:active {
  background: rgba(0, 0, 0, 0.08);
}

.list-item[aria-selected="true"] {
  background: rgba(0, 0, 0, 0.05);
}

/* AFTER */
.list-item {
  background: transparent;
  transition: var(--transition-colors);  /* Add smooth transition */
}

.list-item:hover {
  background: var(--fill-hover);  /* Consistent across app */
}

.list-item:active {
  background: var(--fill-pressed);  /* Higher opacity for tactile feedback */
}

.list-item[aria-selected="true"] {
  background: var(--fill-selected);
}
```

**Step 3: Add transition for smoothness**

```css
.interactive-element {
  /* Always add transition when using fill tokens */
  transition: var(--transition-colors);

  /* Or use individual properties if you need fine control */
  transition: background-color var(--motion-micro) var(--ease-default);
}
```

#### Fill Token Usage Patterns

```css
/* Pattern 1: List items / Menu items */
.list-item {
  background: transparent;
  transition: var(--transition-colors);
}
.list-item:hover {
  background: var(--fill-hover);
}
.list-item:active {
  background: var(--fill-pressed);
}

/* Pattern 2: Buttons (usually use accent color, but can use fill for subtle buttons) */
.button-subtle {
  background: var(--fill-secondary);  /* Very subtle base */
  transition: var(--transition-colors);
}
.button-subtle:hover {
  background: var(--fill-primary);  /* Slightly stronger */
}
.button-subtle:active {
  background: var(--fill-pressed);
}

/* Pattern 3: Table rows with zebra striping */
.table-row:nth-child(even) {
  background: var(--fill-quaternary);  /* Very subtle alternating bg */
}
.table-row:hover {
  background: var(--fill-hover);  /* Overrides zebra on hover */
}
```

**Key Insight:** Fill tokens work on **any background color** because they use rgba opacity. No need for separate tokens per component.

---

### Migrating from Pixel-Based Borders to Semantic Border Tokens

**Problem:** Hard-coded border colors don't adapt to themes and don't communicate purpose.

```css
/* Hard-coded borders */
.panel {
  border: 1px solid #e0e0e0;
}

.input {
  border: 1px solid #cccccc;
}
```

**Solution:** Use opacity-based semantic border tokens that describe **when and why** borders appear.

#### Migration Steps

**Step 1: Ask "Why does this border exist?"**

- **No boundary needed** (whitespace sufficient) → `--border-invisible` (0.00 opacity)
- **Barely visible separation** (list dividers) → `--border-divider` / `--border-hint`
- **Soft section division** (sidebar from editor) → `--border-section` / `--border-subtle`
- **Card/panel edges** → `--border-card`
- **Form inputs** → `--border-input`
- **Focused inputs** → `--border-input-focus`

**Step 2: Replace hard-coded colors**

```css
/* BEFORE */
.sidebar {
  border-right: 1px solid #e0e0e0;
}

.list-item {
  border-bottom: 1px solid #f0f0f0;
}

.card {
  border: 1px solid #d0d0d0;
}

.input {
  border: 1px solid #cccccc;
}

.input:focus {
  border: 1px solid #3b82f6;
}

/* AFTER */
.sidebar {
  border-right: 1px solid var(--border-section);  /* Soft division */
}

.list-item {
  border-bottom: 1px solid var(--border-divider);  /* Barely visible */
}

.card {
  border: 1px solid var(--border-card);  /* Defined card edge */
}

.input {
  border: 1px solid var(--border-input);  /* Clear input affordance */
  transition: var(--transition-colors);
}

.input:focus {
  border-color: var(--border-input-focus);  /* Stronger on focus */
  /* Or use custom focus ring instead */
}
```

#### Border Opacity Progression

```
Invisible (0.00)  →  Hint (0.04)  →  Subtle (0.06)  →  Card (0.08)  →  Input (0.12)  →  Focus (0.18)
     ↑                    ↑                ↑                 ↑                ↑                  ↑
No border needed    List dividers    Section divide    Panel edges      Form inputs      Focused state
```

**Step 3: Consider removing borders entirely**

Ask: **"If I remove this border, is the UI harder to understand?"**

If no, consider using `--border-invisible` or removing the border entirely. Fewer borders = cleaner UI.

```css
/* BEFORE - unnecessary border */
.form-group {
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 16px;
  margin-bottom: 16px;
}

/* AFTER - whitespace alone creates separation */
.form-group {
  padding-bottom: 16px;
  margin-bottom: 16px;
  /* No border needed - spacing is sufficient */
}
```

---

### When to Add Backdrop-Filter for Translucency Effects

**Purpose:** Create native desktop feel with vibrancy (blurred backgrounds) on macOS/Windows while providing solid fallbacks for Linux.

#### When to Use Translucency

✅ **Good candidates for backdrop-filter:**

- **Sidebars** - Persistent UI that benefits from depth cues
- **Command palette** - Overlay that floats above content
- **Floating panels** - Context menus, popovers, tooltips
- **Toolbars** (optional) - Can create Mac-like translucent chrome

❌ **Avoid backdrop-filter on:**

- **Scrollable content** - Performance issues during rapid scrolling
- **Text-heavy areas** - Blur behind text reduces readability
- **Frequently updated elements** - Causes unnecessary repaints
- **Editor content** - Content should be grounded, not floating

#### Migration Steps

**Step 1: Apply translucent background**

```css
.sidebar {
  /* Use translucent token (already has appropriate alpha) */
  background: var(--bg-translucent);

  /* Add backdrop blur */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);  /* Safari/WebKit prefix */
}
```

**Step 2: Add fallback for unsupported platforms**

```css
/* Fallback for browsers without backdrop-filter support (Linux/WebKitGTK) */
@supports not (backdrop-filter: blur(20px)) {
  .sidebar {
    /* Use solid chrome background instead */
    background: var(--chrome-primary-bg);
  }
}
```

**Step 3: Adjust blur radius for performance**

```css
/* Recommended blur radius for 60fps performance */
.sidebar {
  backdrop-filter: blur(20px);  /* ✓ Good - smooth on modern hardware */
}

.command-palette {
  backdrop-filter: blur(24px);  /* ✓ OK - still performant for overlays */
}

.panel {
  backdrop-filter: blur(40px);  /* ✗ Too heavy - may drop frames */
}
```

**Performance Guideline:** Limit blur radius to **20-24px** maximum. Higher values cause frame drops on mid-range hardware.

**Step 4: Optional saturation boost**

```css
.command-palette {
  background: var(--bg-translucent-overlay);

  /* Blur + saturation boost creates "pop" effect */
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
}
```

#### Platform Differences

| Platform | Backdrop Filter Support | Recommendation |
|----------|------------------------|----------------|
| **macOS (WebKit)** | ✅ Full support | Use freely - native vibrancy effect |
| **Windows (Chromium)** | ✅ Full support | Works well on modern hardware |
| **Linux (WebKitGTK)** | ⚠️ Partial support | Always include `@supports not` fallback |

**Testing Checklist:**

- [ ] Test on macOS - verify blur effect works
- [ ] Test on Windows - verify performance acceptable
- [ ] Test on Linux (if available) - verify fallback to solid background
- [ ] Test with colorful content behind sidebar - verify text remains legible
- [ ] Monitor frame rate during scroll (should stay >= 60fps)

---

### Component Migration Checklist

Use this checklist when migrating a component to Apple principles:

#### ✅ Layer Organization

- [ ] Identified component as **content** or **chrome**
- [ ] Applied appropriate layer tokens:
  - [ ] Content: `--content-bg`, `--content-text`, `--content-selection`
  - [ ] Primary chrome: `--chrome-primary-bg/text/border`
  - [ ] Secondary chrome: `--chrome-secondary-bg/text/border`
  - [ ] Tertiary chrome: `--chrome-tertiary`

#### ✅ Elevation

- [ ] Replaced numeric shadows (`--shadow-sm/md/lg`) with semantic elevation
- [ ] Chose correct elevation level:
  - [ ] `--elevation-grounded` (content, no shadow)
  - [ ] `--elevation-raised` (slight lift)
  - [ ] `--elevation-floating` (dropdowns, tooltips)
  - [ ] `--elevation-overlay` (modals, dialogs)
  - [ ] `--elevation-dramatic` (critical alerts only)
- [ ] Tested shadow visibility in both light and dark themes

#### ✅ Fill Tokens

- [ ] Replaced hard-coded rgba hover states with `--fill-hover`
- [ ] Used `--fill-pressed` for active/pressed states
- [ ] Used `--fill-selected` for selected/active items
- [ ] Used `--fill-disabled` for disabled states
- [ ] Added `transition: var(--transition-colors)` for smoothness

#### ✅ Borders

- [ ] Replaced hard-coded border colors with semantic tokens:
  - [ ] `--border-divider` for list item separators
  - [ ] `--border-section` for major divisions
  - [ ] `--border-card` for panel edges
  - [ ] `--border-input` for form inputs
  - [ ] `--border-input-focus` for focused inputs
- [ ] Evaluated if border is needed (consider using `--border-invisible` or removing)

#### ✅ Translucency (Optional)

- [ ] Determined if component benefits from backdrop-filter
- [ ] Applied `var(--bg-translucent)` background
- [ ] Added `backdrop-filter: blur(20px)` with `-webkit-` prefix
- [ ] Included `@supports not` fallback to solid background
- [ ] Tested performance (60fps during scroll)
- [ ] Verified text readability with colorful content behind

#### ✅ Motion

- [ ] Replaced hard-coded transition timings with motion tokens:
  - [ ] `--motion-micro` for color changes (<8px)
  - [ ] `--motion-small` for button press (8-32px)
  - [ ] `--motion-medium` for panel slides (32-128px)
  - [ ] `--motion-large` for modals (128-512px)
- [ ] Used pre-composed transitions when possible:
  - [ ] `--transition-colors`
  - [ ] `--transition-opacity`
  - [ ] `--transition-transform`
  - [ ] `--transition-shadow`
- [ ] Verified animations disable with `prefers-reduced-motion`

#### ✅ Typography

- [ ] Replaced pixel-based font sizes with semantic tokens:
  - [ ] `--type-body` for primary reading text (17px)
  - [ ] `--type-title1/2/3` for headings
  - [ ] `--type-footnote` for metadata
  - [ ] `--type-caption1/2` for small labels
- [ ] Used appropriate line heights:
  - [ ] `--line-height-tight` (1.2) for headings
  - [ ] `--line-height-relaxed` (1.65) for long-form reading

#### ✅ Testing

- [ ] Tested in light theme (standard contrast)
- [ ] Tested in dark theme (standard contrast)
- [ ] Tested with `prefers-contrast: high` (both themes)
- [ ] Tested with `prefers-reduced-motion: reduce`
- [ ] Verified WCAG AA contrast ratios (4.5:1 for normal text)
- [ ] Tested keyboard focus indicators (visible 2-3px ring)
- [ ] Verified component works without backdrop-filter (Linux fallback)

---

### Common Migration Issues

#### Issue 1: Layer Confusion

**Problem:** Not sure if element is content or chrome.

**Solution:**

Ask: **"If I'm typing in the editor, should this element be in my peripheral vision or my direct focus?"**

- **Peripheral** → Chrome (should defer with reduced contrast)
- **Direct focus** → Content (should have maximum prominence)

**Example:**

```css
/* ✗ WRONG - file list in sidebar shouldn't use content tokens */
.file-list {
  background: var(--content-bg);  /* Too prominent for chrome */
  color: var(--content-text);
}

/* ✓ CORRECT - sidebar is chrome */
.file-list {
  background: var(--chrome-primary-bg);  /* Defers to editor */
  color: var(--chrome-primary-text);
}
```

---

#### Issue 2: Elevation Naming

**Problem:** Confused about which elevation to use.

**Solution:**

Think **physical distance**, not importance:

```
Ground level (0px)     → --elevation-grounded (content)
Barely lifted (2-4px)  → --elevation-raised (card on hover)
Floating (8-16px)      → --elevation-floating (dropdown)
High above (32-64px)   → --elevation-overlay (modal)
Very far (128px+)      → --elevation-dramatic (critical alert)
```

**Example:**

```css
/* ✗ WRONG - using elevation for importance */
.error-message {
  /* This is critical but NOT a modal */
  box-shadow: var(--elevation-overlay);  /* Wrong - not an overlay */
}

/* ✓ CORRECT - elevation matches physical position */
.error-message {
  /* Inline error, slightly raised for visibility */
  box-shadow: var(--elevation-raised);
  border-left: 3px solid var(--error-border);  /* Color conveys criticality */
}
```

---

#### Issue 3: Fill Token Opacity

**Problem:** Hover state not visible enough or too strong.

**Solution:**

Don't override fill token opacity. If `--fill-hover` (0.05) is too subtle:

1. Check if you're using it on the right background (should be on `--bg-primary` or similar)
2. Consider using `--fill-pressed` (0.08) for more emphasis
3. If still too subtle, component might need accent color instead

```css
/* ✗ WRONG - overriding fill token defeats the purpose */
.button:hover {
  background: rgba(0, 0, 0, 0.15);  /* Don't do this */
}

/* ✓ CORRECT - use accent color if fill isn't strong enough */
.button {
  background: transparent;
}

.button:hover {
  background: var(--accent-bg);  /* Accent tint instead of fill */
  color: var(--accent-primary);
}
```

---

#### Issue 4: Backdrop-Filter Performance

**Problem:** Scrolling feels laggy after adding backdrop-filter.

**Solution:**

1. **Reduce blur radius** (40px → 20px)
2. **Limit to persistent UI** (don't use on scrollable content)
3. **Check will-change usage** (remove if overused)
4. **Profile with DevTools** (Performance tab)

```css
/* ✗ WRONG - blur too heavy + on scrollable content */
.scrollable-list {
  backdrop-filter: blur(40px);  /* Too expensive */
}

/* ✓ CORRECT - reasonable blur on persistent sidebar */
.sidebar {
  backdrop-filter: blur(20px);  /* Performant */
}

/* Content scrolls inside sidebar, but sidebar itself is fixed */
```

---

#### Issue 5: Border Visibility

**Problem:** Borders too subtle in light/dark theme.

**Solution:**

Check if you're using the right semantic token:

```
Too subtle?
├─ Using --border-hint (0.04)?
│   → Try --border-subtle (0.06) or --border-card (0.08)
│
├─ Using --border-subtle (0.06)?
│   → Try --border-card (0.08) or --border-input (0.12)
│
└─ Using --border-card (0.08) and still too subtle?
    → Element might need stronger visual separation
    → Consider using background color difference instead
```

**Example:**

```css
/* ✗ WRONG - divider too subtle for this context */
.panel-divider {
  border-top: 1px solid var(--border-hint);  /* 0.04 - barely visible */
}

/* ✓ CORRECT - use stronger token for important division */
.panel-divider {
  border-top: 1px solid var(--border-section);  /* 0.06 - perceivable */
}

/* OR consider background separation instead */
.panel-divider {
  border: none;
  background: var(--bg-secondary);  /* Different background creates division */
  padding: 8px 0;
}
```

---

#### Issue 6: Motion Not Respecting User Preferences

**Problem:** Animations still run when user has reduced motion enabled.

**Solution:**

Ensure you're using motion **tokens**, not hard-coded values:

```css
/* ✗ WRONG - hard-coded timing doesn't respond to media query */
.button {
  transition: all 200ms ease;
}

/* ✓ CORRECT - motion token automatically becomes 0ms with prefers-reduced-motion */
.button {
  transition: var(--transition-colors);
}

/* OR */
.button {
  transition: background-color var(--motion-micro) var(--ease-default);
  /* --motion-micro becomes 0ms when user prefers reduced motion */
}
```

**How it works:** The `@media (prefers-reduced-motion: reduce)` rule in `variables.css` sets all `--motion-*` tokens to `0ms`. If you use motion tokens, animations disable automatically.

---

### Migration Examples

See [Component Integration Examples](#component-integration-examples) section for complete code examples demonstrating:

1. Sidebar with translucency + fallback
2. List items with fill token states
3. Modal with semantic elevation
4. Button with motion system
5. High contrast mode handling

---

### Next Steps After Migration

1. **Test thoroughly** - Use migration checklist above
2. **Document decisions** - Add comments explaining token choices
3. **Update component docs** - Note which tokens are used and why
4. **Share learnings** - If you discover edge cases, update this guide

---

## Apple Design Principles

The Vault token system is built on Apple's three core design principles: **Clarity**, **Deference**, and **Depth**. Every token decision is driven by **functional purpose**, not aesthetic preference.

### Clarity: Purpose-Driven Design

> "Functionality drives design decisions. Adornments are subtle and appropriate."

Every color choice answers **"why?"** with a functional reason:

#### ❌ Before: Aesthetic Decisions

```css
/* Decision: "Warm neutrals feel less clinical" */
--bg-primary: #FDFCFA;  /* Warmth for aesthetics */
```

#### ✅ After: Functional Decisions

```css
/* Decision: "Warm backgrounds reduce eye strain during extended writing" */
--bg-writing: #FDFCFA;   /* Functional: reduces eye strain */
--bg-reading: #FFFFFF;   /* Functional: optimal comprehension */
--bg-preview: #FFFFFF;   /* Functional: matches web output */
```

**Key Insight:** Context-aware backgrounds serve specific user tasks, not decorative preferences.

### Deference: Content Supremacy

> "Content is paramount; UI elements defer to it. Minimal visual weight in chrome."

The token hierarchy organizes by **importance to user task**, not UI location:

#### Layer 0: Content (Highest Priority)

```css
/* The actual content the user creates/reads */
--content-bg: #ffffff;
--content-text: var(--neutral-900);
--content-text-secondary: var(--neutral-700);
--content-selection: var(--primary-200);
--content-cursor: var(--neutral-900);
```

**Purpose:** Editor content has maximum contrast and visual prominence.

#### Layer 1: Primary Chrome (Sidebars, Navigation)

```css
/* Supporting UI that should not compete with content */
--chrome-primary-bg: var(--neutral-50);
--chrome-primary-text: var(--neutral-700);       /* Reduced contrast */
--chrome-primary-text-muted: var(--neutral-500); /* Even more subtle */
--chrome-primary-border: var(--neutral-200);     /* Soft dividers */
```

**Purpose:** Chrome elements defer through reduced contrast and subtle borders.

#### Layer 2: Secondary Chrome (Status bars, Tabs, Toolbars)

```css
/* Contextual information with lower visual priority */
--chrome-secondary-bg: var(--neutral-100);
--chrome-secondary-text: var(--neutral-600);
--chrome-secondary-border: var(--neutral-150);
```

#### Layer 3: Tertiary Chrome (Dividers, Subtle Borders)

```css
/* Near-invisible structural elements */
--chrome-tertiary: var(--neutral-200);
--chrome-tertiary-subtle: var(--neutral-100);
```

**Key Insight:** Visual hierarchy matches task importance—content always wins.

#### Border Philosophy: Communicate, Don't Decorate

Borders only appear when they communicate **meaningful boundaries**:

```css
/* Opacity-based borders for Apple-style subtlety */
--border-invisible: rgba(0, 0, 0, 0.00);  /* No border needed */
--border-hint: rgba(0, 0, 0, 0.04);       /* Barely visible separation */
--border-subtle: rgba(0, 0, 0, 0.06);     /* Soft dividers */

/* Semantic purpose assignments */
--border-divider: var(--border-hint);     /* Between list items */
--border-section: var(--border-subtle);   /* Between major sections */
--border-card: rgba(0, 0, 0, 0.08);       /* Card/panel edges */
--border-input: rgba(0, 0, 0, 0.12);      /* Form inputs */
--border-input-focus: rgba(0, 0, 0, 0.18); /* Focused inputs */
```

### Depth: Meaningful Hierarchy Through Translucency

> "Distinct visual layers provide app structure. Translucent backgrounds suggest depth."

#### Purpose-Named Elevation (Not Numeric)

❌ **Before:** `--shadow-sm`, `--shadow-md`, `--shadow-lg` (what do these mean?)

✅ **After:** Elevation names describe **purpose**:

```css
/* Grounded: Content lives here, no elevation */
--elevation-grounded: none;

/* Raised: Floating UI elements (buttons on hover, cards) */
--elevation-raised: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.02);

/* Floating: Dropdowns, popovers, tooltips */
--elevation-floating: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);

/* Overlay: Modals, command palette, search overlay */
--elevation-overlay: 0 8px 24px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.06);

/* Dramatic: Onboarding spotlights, critical alerts */
--elevation-dramatic: 0 16px 48px rgba(0, 0, 0, 0.16), 0 8px 16px rgba(0, 0, 0, 0.08);

/* Legacy aliases for backward compatibility */
--shadow-sm: var(--elevation-raised);
--shadow-md: var(--elevation-floating);
--shadow-lg: var(--elevation-overlay);
```

**Key Insight:** When you see `--elevation-overlay`, you know it's for modals/overlays without consulting documentation.

#### Translucency for Native Desktop Feel

For desktop apps, `backdrop-filter` creates depth through **vibrancy** (not just shadows):

```css
.sidebar {
  background: rgba(250, 250, 250, 0.85);  /* Translucent */
  backdrop-filter: blur(20px);            /* Blurs content behind */
  -webkit-backdrop-filter: blur(20px);
}

.command-palette {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(24px) saturate(180%); /* Blur + color boost */
  box-shadow: var(--elevation-overlay);
}

/* Fallback for browsers without backdrop-filter support */
@supports not (backdrop-filter: blur(20px)) {
  .sidebar {
    background: var(--chrome-primary-bg);  /* Solid fallback */
  }
}
```

**Platform Differences:**

| Platform | Backdrop Filter Support | Notes |
|----------|------------------------|-------|
| **macOS (WebKit)** | ✅ Full support | Native vibrancy effect |
| **Windows (Chromium)** | ✅ Full support | Performs well on modern hardware |
| **Linux (WebKitGTK)** | ⚠️ Partial support | Fallback to solid backgrounds via `@supports not` |

**Performance:** Limit blur radius to 20-24px for 60fps performance. Apply only to persistent UI (sidebar, panels), not scrollable content.

### Fill Tokens: Apple's Interaction State System

Apple uses a **four-level fill hierarchy** for interactive element backgrounds:

```css
/* Primary: Hover states, selected items */
--fill-primary: rgba(0, 0, 0, 0.05);

/* Secondary: Subtle backgrounds, zebra striping */
--fill-secondary: rgba(0, 0, 0, 0.03);

/* Tertiary: Very subtle, background hints */
--fill-tertiary: rgba(0, 0, 0, 0.02);

/* Quaternary: Near-invisible, skeleton loaders */
--fill-quaternary: rgba(0, 0, 0, 0.01);

/* Semantic fill assignments */
--fill-hover: var(--fill-primary);
--fill-selected: var(--fill-primary);
--fill-pressed: rgba(0, 0, 0, 0.08);  /* Higher opacity for pressed state */
--fill-disabled: var(--fill-tertiary);
```

**Dark mode uses white rgba:**

```css
[data-theme="dark"] {
  --fill-primary: rgba(255, 255, 255, 0.08);
  --fill-pressed: rgba(255, 255, 255, 0.12);
}
```

**Usage Example:**

```css
.list-item {
  background: transparent;
  transition: var(--transition-colors);
}

.list-item:hover {
  background: var(--fill-hover);  /* Consistent across all list items */
}

.list-item:active {
  background: var(--fill-pressed);
}

.list-item[aria-selected="true"] {
  background: var(--fill-selected);
}
```

### Dark Mode: Apple's Elevated Surface Strategy

> "Elevated surfaces get progressively lighter in dark mode."

#### Dark Theme with Blue Undertone

Apple's dark grays have a **slight blue undertone** (#1C1C1E vs pure #1C1C1C) that feels more alive:

```css
[data-theme="dark"] {
  /* Base: True background (window background) */
  --bg-primary: #1C1C1E;        /* Apple systemBackground (blue undertone) */

  /* Elevated: Sidebars, cards, panels */
  --bg-secondary: #2C2C2E;      /* +16 hex value (elevated) */

  /* Further elevated: Dropdowns, nested panels */
  --bg-tertiary: #3A3A3C;       /* +14 hex value */

  /* Highest: Tooltips, overlays, popovers */
  --bg-elevated: #48484A;       /* +14 hex value */
}
```

**Pattern:** Each elevation step lightens by approximately 14-16 hex value. The progression creates **perceivable depth** in multi-layer UIs (modal over sidebar over editor).

**Alternative:** Pure neutral scale documented in comments for brand flexibility:

```css
/* Alternative: Pure neutral scale (if blue undertone conflicts with brand) */
/* --bg-primary: #171717; */
/* --bg-secondary: #1F1F1F; */
/* --bg-tertiary: #2A2A2A; */
/* --bg-elevated: #333333; */
```

### Physics-Based Motion System

> "Fluid motion and refined animations provide meaning."

#### Duration Based on Distance Traveled

Motion tokens are tied to **distance**, not importance:

```css
/* Duration tokens - tied to movement distance, not component importance */
--motion-instant: 0ms;        /* Immediate feedback (no animation) */
--motion-micro: 100ms;        /* < 8px movement (color changes, opacity) */
--motion-small: 150ms;        /* 8-32px movement (button press, small reveals) */
--motion-medium: 200ms;       /* 32-128px movement (panel slides, card flips) */
--motion-large: 300ms;        /* 128-512px movement (modal entry, page transitions) */
--motion-xl: 400ms;           /* > 512px movement (full-screen transitions) */
```

**Key Insight:** A 500px modal slide uses `--motion-large` (300ms), while a 10px button press uses `--motion-micro` (100ms). Duration reflects physics, not UI hierarchy.

#### Apple-Inspired Easing Curves

```css
/* Default: Smooth, natural feeling */
--ease-default: cubic-bezier(0.25, 0.1, 0.25, 1.0);

/* Enter: Elements appearing (decelerate into view) */
--ease-enter: cubic-bezier(0.0, 0.0, 0.2, 1.0);

/* Exit: Elements leaving (accelerate out of view) */
--ease-exit: cubic-bezier(0.4, 0.0, 1.0, 1.0);

/* Emphasized: Important state changes, calls attention */
--ease-emphasized: cubic-bezier(0.4, 0.0, 0.2, 1.0);

/* Spring: Playful, bouncy (use sparingly) */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1.0);
```

#### Pre-Composed Transitions

```css
/* Common use cases pre-composed for consistency */
--transition-colors: color var(--motion-micro) var(--ease-default),
                     background-color var(--motion-micro) var(--ease-default),
                     border-color var(--motion-micro) var(--ease-default);

--transition-opacity: opacity var(--motion-small) var(--ease-default);

--transition-transform: transform var(--motion-medium) var(--ease-emphasized);

--transition-shadow: box-shadow var(--motion-small) var(--ease-default);

--transition-dimensions: width var(--motion-medium) var(--ease-emphasized),
                         height var(--motion-medium) var(--ease-emphasized);
```

#### Accessibility: Respect User Preference

```css
/* Disable all animations when user prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-instant: 0ms;
    --motion-micro: 0ms;
    --motion-small: 0ms;
    --motion-medium: 0ms;
    --motion-large: 0ms;
    --motion-xl: 0ms;
    /* Easing curves remain defined but have no effect with 0ms duration */
  }
}
```

### Four-Variant Accessibility System

Apple requires **four variants** for complete accessibility coverage:

#### Variant Matrix: Theme × Contrast

```
                    Standard Contrast       High Contrast
Light Mode          light + standard        light + high
Dark Mode           dark + standard         dark + high
```

#### High Contrast Mode Implementation

```css
/* VARIANT 3: Light Mode, High Contrast */
@media (prefers-contrast: high) {
  :root {
    --text-primary: #000000;    /* Maximum contrast (21:1) */
    --text-secondary: #262626;  /* 14:1 on white */
    --text-tertiary: #525252;   /* 7.5:1 on white (WCAG AAA) */

    /* Stronger borders for visibility */
    --border-light: rgba(0, 0, 0, 0.2);    /* 0.08 → 0.2 */
    --border-medium: rgba(0, 0, 0, 0.3);   /* 0.12 → 0.3 */
    --border-input-focus: rgba(0, 0, 0, 0.5);

    /* Enhanced focus indicators */
    --focus-ring-width: 3px;    /* 2px → 3px */
    --focus-ring-offset: 2px;
  }

  /* VARIANT 4: Dark Mode, High Contrast */
  [data-theme="dark"] {
    --text-primary: #FFFFFF;    /* Maximum contrast */
    --text-secondary: #E5E5E5;  /* 13:1 on #1C1C1E */
    --text-tertiary: #B0B0B0;   /* 7.5:1 on #1C1C1E (WCAG AAA) */

    --border-light: rgba(255, 255, 255, 0.2);
    --border-medium: rgba(255, 255, 255, 0.3);
    --border-input-focus: rgba(255, 255, 255, 0.5);
  }
}
```

**Testing:** Use browser DevTools to simulate `prefers-contrast: high` and verify all text meets WCAG AAA (7.5:1+).

### Typography: Apple-Inspired Scale

Apple uses **17px** as base body size (not 16px) for improved readability:

```css
/* Display sizes - for hero/marketing content */
--type-display: 48px;

/* Title hierarchy */
--type-largeTitle: 34px;      /* Screen/page titles */
--type-title1: 28px;          /* Major section headers */
--type-title2: 22px;          /* Card/panel headers */
--type-title3: 20px;          /* Subsection headers */

/* Body text */
--type-headline: 17px;        /* Bold/emphasized body */
--type-body: 17px;            /* Primary reading text (Apple default) */
--type-callout: 16px;         /* Supporting information */

/* Secondary text */
--type-subheadline: 15px;     /* Secondary labels */
--type-footnote: 13px;        /* Timestamps, metadata */
--type-caption1: 12px;        /* Small labels, badges */
--type-caption2: 11px;        /* Smallest legible text */
```

**Rationale:** The 1px difference (17px vs 16px) improves readability in long-form text without feeling oversized.

---

## Token Rationale

This section explains the **functional purpose** behind each token category. Every token answers "why?" with a functional reason, not an aesthetic preference.

### Content Layer Tokens

**Why content needs highest contrast and least distraction:**

The content layer represents what the user is actively creating or reading—the markdown text, the document body, the actual knowledge they're working with. This layer must have:

1. **Maximum contrast** (16.1:1 in light, 18.5:1 in dark) because users spend hours reading and writing here. Lower contrast causes eye strain, reading fatigue, and comprehension errors.

2. **Pure white background** (#FFFFFF in light) to eliminate visual noise. Any tint, texture, or color would compete with syntax highlighting, formatting, and user-created content.

3. **Strongest text color** (--content-text uses neutral-900/#171717) to ensure legibility across all lighting conditions—from dim evening editing to bright daylight work.

4. **Dedicated selection color** (--content-selection) optimized for editor context, not generic UI selection. Text selection happens constantly during writing; it needs to be visible but not overwhelming.

**Functional outcome:** When a user opens Vault, their eyes immediately go to the content, not the sidebar, toolbar, or status bar. The content "pops" because everything else deliberately recedes.

### Chrome Layer Tokens

**Why chrome layers show progressive visual deferment:**

Chrome elements (sidebars, toolbars, status bars) support the content but must not compete with it. The three-tier hierarchy creates visual stepping:

#### Primary Chrome (Layer 1)
- **Reduced contrast text** (--chrome-primary-text: neutral-700) vs content (neutral-900) makes chrome literally harder to see, forcing your eye toward content
- **Neutral-50 background** creates subtle separation from content's pure white without drawing attention
- **Soft borders** (neutral-200) define boundaries without harsh lines

**Why this matters:** When scanning the screen, your peripheral vision processes chrome as "supporting information" while your foveal vision focuses on content.

#### Secondary Chrome (Layer 2)
- **Even lower contrast** (neutral-600 text, neutral-100 bg) for status bars and tabs
- These elements provide context (file path, word count) but shouldn't interrupt flow
- **Functional rationale:** You check status occasionally, not constantly—visual weight matches usage frequency

#### Tertiary Chrome (Layer 3)
- **Near-invisible** (neutral-200) dividers and structural borders
- Communicate spatial organization without visual weight
- **Functional rationale:** Users perceive document structure subconsciously; explicit borders would be visual clutter

**Key insight:** If everything has equal contrast, nothing has hierarchy. Progressive deferment creates a visual "gravity" pulling eyes toward content.

### Fill Tokens

**Why Apple's four-level interaction state system:**

Fill tokens solve a specific problem: **how to show hover/selected/pressed states without hard-coded colors**. Apple's system uses subtle opacity overlays:

1. **Fill Primary (0.05 black, 0.08 white)** - Hover states for list items, buttons, menu items
   - **Why this opacity?** Visible enough to confirm interaction, subtle enough not to feel "heavy"
   - **Why rgba?** Works on any background color—no need for separate tokens per component

2. **Fill Secondary (0.03/0.05)** - Zebra striping in tables, subtle backgrounds
   - **Functional rationale:** Helps eye track rows without adding visual weight

3. **Fill Tertiary (0.02/0.03)** - Very subtle hints, skeleton loaders
   - Nearly invisible but perceivable—creates "ghost" effect for loading states

4. **Fill Quaternary (0.01/0.02)** - Near-invisible, used for active line highlighting
   - **Why so subtle?** Active line should be perceivable but not distracting during typing

**Fill Pressed (0.08/0.12)** - Higher opacity than hover
- **Functional rationale:** Physical buttons compress when pressed; digital buttons should "darken" to simulate depth

**Why this works:** Consistent interaction states across the entire app. Every list item, button, and clickable element uses the same fill tokens—muscle memory transfers between contexts.

### Elevation Tokens

**When to use each elevation level:**

Elevation communicates **spatial hierarchy**, not importance. Elements closer to the user cast larger shadows:

#### Grounded (none)
- **What:** Editor content, document text, main work surface
- **Why no shadow?** The content IS the surface—everything else floats above it
- **Functional purpose:** Creates baseline for other elements to elevate from

#### Raised (1-2px blur)
- **What:** Buttons on hover, cards, small panels
- **Why minimal shadow?** Just barely lifted off the page
- **Functional purpose:** Signals "I'm interactive" without dominating the page
- **Distance simulation:** ~2-4px above surface

#### Floating (4-12px blur)
- **What:** Dropdowns, popovers, tooltips, context menus
- **Why larger shadow?** These temporarily appear over content
- **Functional purpose:** Clear hierarchy—"I'm temporarily on top"
- **Distance simulation:** ~8-16px above surface

#### Overlay (8-24px blur)
- **What:** Modals, dialogs, command palette
- **Why dramatic shadow?** Takes over the entire screen
- **Functional purpose:** "Stop what you're doing and look at me"
- **Distance simulation:** ~32-64px above surface

#### Dramatic (16-48px blur)
- **What:** Onboarding spotlights, critical alerts, tour callouts
- **Why extreme shadow?** Demands immediate attention
- **Functional purpose:** Used sparingly for truly critical moments
- **Distance simulation:** ~128px+ above surface

**Key principle:** Shadow size correlates with **how far the element is from the base surface**, not how important it is. A modal is "far" because it blocks the entire page; a tooltip is "near" because it's contextual.

**Dark mode difference:** Shadows ~1.5-2x stronger (higher opacity) because dark backgrounds make shadows harder to see. Same perceived depth, adjusted for theme.

### Border Tokens

**Why opacity-based borders and when they communicate vs. decorate:**

Borders serve two functions:
1. **Communicate boundaries** between distinct regions
2. **Decorate** (which we avoid)

The opacity-based system lets you choose the **minimum perceptible border** for each context:

#### Border Invisible (0.00)
- **When to use:** No boundary needed—whitespace alone creates separation
- **Example:** Between form fields with adequate spacing
- **Functional rationale:** Fewer borders = cleaner UI

#### Border Hint (0.04)
- **When to use:** List item dividers where rows are already distinct
- **Functional rationale:** Helps eye track horizontal alignment without adding visual weight
- **Example:** File list in sidebar—you can perceive the divisions but barely

#### Border Subtle (0.06)
- **When to use:** Major section dividers (sidebar from editor)
- **Functional rationale:** Defines zones without harsh lines
- **Example:** Gray line between navigation and content

#### Border Card/Input/Focus (0.08-0.18)
- **When to use:** Need clear visual boundary for interaction
- **Functional rationale:** Cards need definition, inputs need affordance, focus needs visibility
- **Progression:** Stronger border = more interactivity or importance

**Why opacity instead of solid colors?**
1. Works on any background without manual adjustment
2. Automatically adapts to theme changes (black rgba in light, white rgba in dark)
3. Creates consistent visual weight across different contexts

**When borders decorate:** If removing a border doesn't make the UI harder to understand, it was decorative. Remove it.

### Motion Tokens

**Why duration is tied to distance traveled:**

Motion should reflect **physics**, not arbitrary timing. Real objects take longer to move farther:

#### Motion Micro (100ms, <8px)
- **What:** Color changes, opacity fades, small icon rotations
- **Why 100ms?** Human perception threshold—any faster feels instant, any slower feels laggy
- **Example:** Button color on hover, text color on theme switch

#### Motion Small (150ms, 8-32px)
- **What:** Button press, checkbox toggle, small reveals
- **Why 150ms?** Matches physical button press duration—feels responsive but not abrupt
- **Example:** Dropdown arrow rotation, badge appearance

#### Motion Medium (200ms, 32-128px)
- **What:** Panel slides, card flips, sidebar collapse
- **Why 200ms?** Panel movement is visible; too fast feels jarring, too slow feels sluggish
- **Example:** Settings panel sliding in from right

#### Motion Large (300ms, 128-512px)
- **What:** Modal entry, page transitions, full-panel reveals
- **Why 300ms?** Large movements need time to feel smooth—faster would feel mechanical
- **Example:** Command palette opening with backdrop blur

#### Motion XL (400ms, >512px)
- **What:** Full-screen transitions, onboarding sequences
- **Why 400ms?** Maximum natural movement duration—longer risks feeling "slow"
- **Example:** Switching between vault folders

**Key insight:** A 500px modal sliding in uses Motion Large (300ms). A 10px button press uses Motion Micro (100ms). If you swapped these, the button would feel sluggish and the modal would slam in.

**Easing curves explain HOW it moves:**
- **Ease-enter** (decelerate): Element enters view, slowing to a stop—feels like gravity
- **Ease-exit** (accelerate): Element leaves view, speeding up—feels like momentum
- **Ease-emphasized**: Important state changes that need attention

**Reduced motion override:** All durations become 0ms when user prefers reduced motion. Easing curves still exist but have no effect—maintains code simplicity.

### Typography Tokens

**Why 17px base and semantic naming benefits:**

#### The 17px Base Rationale

Apple chose **17px** (not 16px) for iOS and macOS body text based on readability research:

1. **Character recognition:** At typical reading distances (20-30 inches), 17px font creates letter shapes large enough for subconscious pattern recognition—you read faster without realizing it

2. **Eye strain reduction:** The 1px difference accumulates. Reading 1000 words at 16px vs 17px shows measurable difference in fatigue over 30+ minutes

3. **Scale harmony:** 17px creates cleaner ratios for larger text (34px = 2×, 51px = 3×) than 16px (32px = 2×, but 48px = 3× is too small for displays)

**Testing this:** Try reading a long article at 16px, then 17px. At first they feel identical. After 10 minutes, 17px feels more comfortable. After an hour, 16px feels cramped.

#### Semantic Naming Benefits

❌ **Before:** `--font-size-24`, `--font-size-18`, `--font-size-14`
- What is size 24 used for? Headers? Emphasis? Who knows without looking it up.

✅ **After:** `--type-title1`, `--type-body`, `--type-footnote`
- Immediately clear: title1 is for major headers, body is for reading text, footnote is for metadata

**Functional benefits:**
1. **Self-documenting code:** `font-size: var(--type-headline)` vs `font-size: var(--font-18)`
2. **Refactoring safety:** Change all headlines from 17px to 18px by updating one token
3. **Semantic adjustments:** Can make title1 bigger on mobile without touching component code

#### The Complete Scale Philosophy

```
Display (48px)      → Marketing, hero sections (rare in note app)
Large Title (34px)  → Page/screen titles (vault name, settings screens)
Title 1-3 (28-20px) → Markdown headings H1-H3
Headline (17px)     → Emphasized body, bolded text
Body (17px)         → Primary reading text (THE MOST IMPORTANT SIZE)
Callout (16px)      → Supporting info, help text
Subheadline (15px)  → Secondary labels, metadata labels
Footnote (13px)     → Timestamps, word counts, file sizes
Caption (12-11px)   → Smallest legible (badges, fine print)
```

**Why this range?**
- 48px is ~4.4× larger than 11px (maximum ratio before text feels "too different")
- Each step is perceptually distinct without being jarring
- Scale covers every use case from hero text to fine print

**Line height pairing:**
- Titles use tight (1.2) - single-line UI needs minimal spacing
- Body uses relaxed (1.65) - multi-paragraph reading needs breathing room
- Long-form editor uses loose (1.8) - prevents line-skipping during long sessions

**Functional outcome:** Vault's text never feels cramped or excessive—every size has a reason tied to reading ergonomics, not aesthetics.

---

## Component Integration Examples

This section provides complete code examples demonstrating how to use Apple principle tokens in real components. Each example includes both correct (✓) and incorrect (✗) patterns to illustrate best practices.

### Example 1: Sidebar with Translucency

**Purpose:** Create a native desktop feel with backdrop blur and graceful fallback for unsupported platforms.

#### ✓ Correct Implementation

```css
.sidebar {
  /* Translucent background with Apple-style vibrancy */
  background: var(--bg-translucent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px); /* Safari prefix */

  /* Content styling */
  color: var(--chrome-primary-text);
  border-right: 1px solid var(--border-section);

  /* Keep content above blur effect */
  z-index: 10;
}

/* Fallback for browsers without backdrop-filter support */
@supports not (backdrop-filter: blur(20px)) {
  .sidebar {
    /* Use solid chrome background instead of translucent */
    background: var(--chrome-primary-bg);
  }
}

/* Dark theme adjustments (automatic via CSS variables) */
[data-theme="dark"] .sidebar {
  /* Variables automatically reference dark variants */
  /* No manual overrides needed! */
}
```

**Why this works:**
- Uses `var(--bg-translucent)` which is already defined with proper rgba values (0.85 alpha)
- Includes `-webkit-` prefix for Safari/WebKit compatibility
- `@supports not` provides solid fallback for Linux/WebKitGTK
- Theme switching handled automatically by CSS variables

#### ✗ Incorrect Implementation

```css
.sidebar {
  /* ✗ Hard-coded rgba - won't adapt to themes */
  background: rgba(250, 250, 250, 0.85);
  backdrop-filter: blur(20px);

  /* ✗ Hard-coded color - breaks dark mode */
  color: #404040;

  /* ✗ No fallback - breaks on unsupported platforms */
}
```

**Why this fails:**
- Hard-coded rgba won't switch between light (250,250,250) and dark (30,30,30)
- Text color #404040 is too light on dark backgrounds (contrast failure)
- Missing fallback means broken UI on Linux

---

### Example 2: List Items with Fill Tokens

**Purpose:** Consistent hover/selected/pressed states across all interactive lists using Apple's fill system.

#### ✓ Correct Implementation

```css
.list-item {
  /* Base state: transparent background */
  background: transparent;

  /* Content styling using semantic tokens */
  color: var(--text-primary);
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-divider);

  /* Smooth transition using pre-composed token */
  transition: var(--transition-colors);

  /* Prevent text selection during rapid clicking */
  user-select: none;
}

/* Hover state - subtle fill overlay */
.list-item:hover {
  background: var(--fill-hover);
  cursor: pointer;
}

/* Active/pressed state - stronger fill for tactile feedback */
.list-item:active {
  background: var(--fill-pressed);

  /* Micro scale-down simulates button press */
  transform: scale(0.98);

  /* Faster transition for immediate feedback */
  transition-duration: var(--motion-micro);
}

/* Selected state - persistent fill */
.list-item[aria-selected="true"] {
  background: var(--fill-selected);

  /* Slightly darker text for visual confirmation */
  color: var(--text-primary);
  font-weight: 500;
}

/* Disabled state - muted fill and text */
.list-item:disabled,
.list-item[aria-disabled="true"] {
  background: var(--fill-disabled);
  color: var(--text-disabled);
  cursor: not-allowed;
  opacity: 0.6;
}
```

**Why this works:**
- All fill tokens (hover/pressed/selected/disabled) use consistent opacity system
- Works on any background color without manual adjustment
- Automatically adapts to light/dark themes
- Uses pre-composed `--transition-colors` for consistency across app
- Includes accessibility attributes (aria-selected, aria-disabled)

#### ✗ Incorrect Implementation

```css
.list-item {
  background: transparent;
  color: var(--text-primary);
}

/* ✗ Hard-coded rgba - won't adapt to themes */
.list-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

/* ✗ Using wrong opacity - should be 0.08, not 0.05 */
.list-item:active {
  background: rgba(0, 0, 0, 0.05);
}

/* ✗ Hard-coded color - breaks in dark mode */
.list-item[aria-selected="true"] {
  background: #e3e3e3;
}

/* ✗ No transition - feels abrupt */
```

**Why this fails:**
- Hard-coded rgba(0,0,0,...) stays black in dark mode (should be white)
- Active state uses same opacity as hover (no tactile feedback)
- Selected state uses solid color that doesn't scale to dark mode
- Missing transition makes interactions feel mechanical

---

### Example 3: Modal with Semantic Elevation

**Purpose:** Layer modals over existing content with proper depth cues using purpose-named elevation.

#### ✓ Correct Implementation

```css
/* Modal overlay - dims background content */
.modal-overlay {
  /* Full viewport coverage */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;

  /* Semi-transparent dark overlay */
  background: rgba(0, 0, 0, 0.4);

  /* Subtle blur for depth (optional) */
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);

  /* Above normal content, below modal container */
  z-index: 100;

  /* Fade in animation */
  animation: fadeIn var(--motion-medium) var(--ease-enter);
}

/* Modal container - the actual dialog */
.modal-container {
  /* Centered in viewport */
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  /* Semantic background token */
  background: var(--bg-primary);

  /* Purpose-named elevation for modal overlays */
  box-shadow: var(--elevation-overlay);

  /* Rounded corners for softness */
  border-radius: 12px;

  /* Responsive width */
  width: 90%;
  max-width: 600px;
  max-height: 80vh;

  /* Above overlay */
  z-index: 101;

  /* Scale + slide entry animation */
  animation: modalEnter var(--motion-large) var(--ease-enter);
}

/* Modal content area */
.modal-content {
  padding: 24px;
  color: var(--text-primary);
  overflow-y: auto;
  max-height: calc(80vh - 120px); /* Account for header/footer */
}

/* Modal header */
.modal-header {
  border-bottom: 1px solid var(--border-section);
  padding-bottom: 16px;
  margin-bottom: 16px;
}

.modal-title {
  font-size: var(--type-title2);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0;
}

/* Animation keyframes */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes modalEnter {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
```

**Why this works:**
- Uses `--elevation-overlay` which semantically describes "modal over content"
- Shadow automatically adjusts for light/dark themes (stronger in dark)
- Motion tokens tied to animation distance (large movement = 300ms)
- Ease-enter curve decelerates into view (feels natural)
- Proper z-index layering (overlay < container)

#### ✗ Incorrect Implementation

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.4);
  /* ✗ No z-index - might appear under content */
}

.modal-container {
  background: #ffffff;

  /* ✗ Numeric shadow - doesn't describe purpose */
  box-shadow: var(--shadow-lg);

  /* ✗ Hard-coded animation timing - not tied to distance */
  animation: modalEnter 250ms ease-out;

  /* ✗ Hard-coded transform - won't adjust for motion preferences */
}

@keyframes modalEnter {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
```

**Why this fails:**
- `--shadow-lg` is generic (could be anything); `--elevation-overlay` is semantic
- Hard-coded 250ms doesn't use motion system (won't respect reduced motion)
- Animation won't disable for users who prefer reduced motion
- Missing fallback for backdrop-filter

---

### Example 4: Button with Motion System

**Purpose:** Create responsive button with physics-based animations that respect user motion preferences.

#### ✓ Correct Implementation

```css
.button {
  /* Base styling using semantic tokens */
  background-color: var(--accent-primary);
  color: var(--text-inverse);

  /* Typography tokens for consistency */
  font-size: var(--type-callout);
  font-weight: var(--font-weight-medium);

  /* Spacing and shape */
  padding: 10px 20px;
  border: none;
  border-radius: 6px;

  /* Cursor and accessibility */
  cursor: pointer;
  user-select: none;

  /* Initial elevation - subtle raise */
  box-shadow: var(--elevation-raised);

  /* Pre-composed transitions for colors and shadow */
  transition: var(--transition-colors), var(--transition-shadow);

  /* Will-change hint for browser optimization (use sparingly) */
  will-change: transform, box-shadow;
}

/* Hover state - increase elevation */
.button:hover {
  background-color: var(--accent-hover);

  /* Increase elevation to "floating" */
  box-shadow: var(--elevation-floating);

  /* Subtle lift effect */
  transform: translateY(-1px);

  /* Add transform to transition list */
  transition: var(--transition-colors),
              var(--transition-shadow),
              var(--transition-transform);
}

/* Active/pressed state - reduce elevation */
.button:active {
  background-color: var(--accent-active);

  /* Return to base position (or slightly lower) */
  transform: translateY(0);

  /* Faster transition for immediate tactile feedback */
  transition-duration: var(--motion-micro);

  /* Slightly reduce shadow */
  box-shadow: var(--elevation-grounded);
}

/* Focus state - accessibility critical */
.button:focus {
  outline: none;

  /* Custom focus ring with offset */
  box-shadow: 0 0 0 2px var(--bg-primary),  /* Offset ring */
              0 0 0 4px var(--focus-ring);   /* Colored ring */
}

/* Focus + hover - combine both effects */
.button:focus:hover {
  box-shadow: 0 0 0 2px var(--bg-primary),
              0 0 0 4px var(--focus-ring),
              var(--elevation-floating);
}

/* Disabled state */
.button:disabled {
  background-color: var(--fill-disabled);
  color: var(--text-disabled);
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
  opacity: 0.5;
}
```

**Why this works:**
- Motion tokens (`--motion-micro` for press) tied to physical distance traveled
- Elevation progresses semantically: raised → floating → grounded
- Transform + shadow creates depth simulation
- Faster transition on active (100ms) for immediate feedback
- Focus ring meets 3:1 contrast requirement with proper offset
- Automatically respects `prefers-reduced-motion` (all durations become 0ms)

#### ✗ Incorrect Implementation

```css
.button {
  background-color: #3b82f6;
  color: #ffffff;

  /* ✗ Hard-coded timing - arbitrary 200ms */
  transition: all 200ms ease;

  /* ✗ Using "all" is inefficient - animates everything */
}

.button:hover {
  /* ✗ Hard-coded color - won't work in dark mode */
  background-color: #2563eb;

  /* ✗ No elevation change - misses depth cue */
  transform: translateY(-2px);
}

.button:active {
  /* ✗ Same timing as hover - no tactile differentiation */
  transition: all 200ms ease;
}

/* ✗ No focus state - accessibility failure */

/* ✗ No reduced motion support - ignores user preferences */
```

**Why this fails:**
- `transition: all` animates properties that don't change (inefficient)
- Hard-coded 200ms not tied to distance or motion system
- Missing focus state violates WCAG keyboard accessibility
- Won't disable animations for `prefers-reduced-motion` users
- Hover/active have same timing (no tactile feedback difference)

---

### Example 5: High Contrast Mode Handling

**Purpose:** Ensure UI remains usable with enhanced contrast and borders when user enables system high contrast mode.

#### ✓ Correct Implementation

```css
/* Base styles - works in standard contrast */
.card {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  padding: 16px;
}

.card-title {
  color: var(--text-primary);
  font-size: var(--type-title3);
  font-weight: var(--font-weight-semibold);
  margin-bottom: 8px;
}

.card-meta {
  color: var(--text-tertiary);
  font-size: var(--type-footnote);
}

.card-action {
  color: var(--accent-primary);
  text-decoration: underline;
  cursor: pointer;
}

/* High contrast mode enhancements */
@media (prefers-contrast: high) {
  .card {
    /* Stronger border for better definition */
    border-width: 2px;

    /* Border automatically uses stronger variant from variables.css:
       --border-card changes from rgba(0,0,0,0.08) to rgba(0,0,0,0.2) */
  }

  .card-title {
    /* Text automatically strengthens:
       --text-primary: #000000 (pure black, 21:1 contrast) */

    /* Optional: increase weight for extra emphasis */
    font-weight: var(--font-weight-bold);
  }

  .card-meta {
    /* Tertiary text strengthens:
       --text-tertiary: #525252 (7.5:1 contrast, WCAG AAA) */
  }

  .card-action {
    /* Links get stronger focus indicators (handled in variables.css) */
    text-decoration-thickness: 2px;
  }

  /* Focus states get enhanced rings */
  .card-action:focus {
    outline: none;
    box-shadow: 0 0 0 var(--focus-ring-offset) var(--bg-primary),
                0 0 0 var(--focus-ring-width) var(--focus-ring);
    /* --focus-ring-width: 3px in high contrast (vs 2px standard) */
  }
}

/* Dark mode + high contrast */
@media (prefers-contrast: high) {
  [data-theme="dark"] .card {
    /* Border uses white rgba in dark mode */
    /* --border-card: rgba(255,255,255,0.2) in dark high contrast */
  }

  [data-theme="dark"] .card-title {
    /* --text-primary: #FFFFFF (pure white) */
  }

  [data-theme="dark"] .card-meta {
    /* --text-tertiary: #B0B0B0 (7.5:1 on #1C1C1E) */
  }
}
```

**Why this works:**
- Media query automatically activates when user enables system high contrast
- Border width increases (1px → 2px) for better visibility
- Text colors strengthen automatically via CSS variable updates
- Focus ring width increases (2px → 3px) for keyboard users
- Four variants handled: light standard, dark standard, light high contrast, dark high contrast
- No manual color calculations needed—tokens handle everything

#### ✗ Incorrect Implementation

```css
.card {
  background: #f5f5f5;
  color: #1a1a1a;
  border: 1px solid #e0e0e0;
}

.card-meta {
  /* ✗ Hard-coded gray - might fail contrast in high contrast mode */
  color: #999999;
}

/* ✗ No high contrast mode handling at all */
/* ✗ Hard-coded colors won't strengthen automatically */
```

**Why this fails:**
- Hard-coded #999999 has 2.8:1 contrast on white (fails WCAG AA)
- No `@media (prefers-contrast: high)` means UI doesn't adapt
- Users who need high contrast get same low-contrast UI
- No automatic strengthening of text/borders

**Testing high contrast mode:**
- **macOS:** System Preferences → Accessibility → Display → Increase Contrast
- **Windows:** Settings → Ease of Access → High Contrast
- **Browser DevTools:** Rendering tab → Emulate CSS media feature `prefers-contrast: high`

---

### Integration Pattern Summary

| Pattern | Use Case | Key Tokens | Critical Feature |
|---------|----------|------------|------------------|
| **Translucency** | Sidebars, panels | `--bg-translucent`, `backdrop-filter` | `@supports` fallback |
| **Fill States** | Lists, buttons, menus | `--fill-hover/pressed/selected` | Consistent opacity system |
| **Elevation** | Modals, dropdowns, cards | `--elevation-overlay/floating/raised` | Purpose-based naming |
| **Motion** | Buttons, transitions | `--motion-micro/small/medium` | Distance-based duration |
| **High Contrast** | All interactive elements | Media query `prefers-contrast: high` | Automatic strengthening |

### Common Mistakes to Avoid

1. **❌ Hard-coded colors** - Always use CSS variables for theme compatibility
2. **❌ Numeric shadows** - Use semantic elevation tokens (`--elevation-overlay` not `--shadow-lg`)
3. **❌ Missing fallbacks** - Always include `@supports not` for backdrop-filter
4. **❌ Ignoring motion preferences** - Motion system automatically respects `prefers-reduced-motion`
5. **❌ Skipping high contrast** - Users with vision needs rely on this feature
6. **❌ Using `transition: all`** - Be specific to avoid animating unintended properties
7. **❌ No focus states** - Keyboard users need visible focus indicators (WCAG requirement)

---

## Design Principles

These principles guided the token system design and should guide future additions:

### 1. Blue, Not Purple

The primary accent color is **blue** (`#3b82f6` family). No purple or indigo anywhere in the palette, including syntax highlighting.

**Rationale:** User explicitly requested blue as brand color. Purple can cause confusion with links and has different cultural associations.

### 2. Neutral Foundation

Most UI chrome uses the neutral (gray) scale. Color is reserved for meaning: status (success/warning/error), emphasis (accent), and interaction (links, buttons).

**Rationale:** Excessive color creates visual noise. Neutral palette puts focus on content.

### 3. Accessibility Non-Negotiable

Every text color **must** meet WCAG AA (4.5:1 minimum). No exceptions.

**Rationale:** 1 in 12 men and 1 in 200 women have color vision deficiency. Low contrast affects everyone in bright/dim lighting.

### 4. Semantic Over Literal

Use `--text-secondary`, not `--gray-600`. Tokens describe **purpose**, not **appearance**.

**Rationale:** Semantic names survive theme changes. `--gray-600` might be light gray in dark mode.

### 5. Theme Parity

Every component works equally well in light and dark. No "dark-only" or "light-only" components.

**Rationale:** User experience should be consistent regardless of theme preference.

---

## Resources

- **Specification:** `.docs/specs/2025-12-13-color-system/spec.md`
- **Technical Details:** `.docs/specs/2025-12-13-color-system/sub-specs/technical-spec.md`
- **Test Coverage:** `.docs/specs/2025-12-13-color-system/sub-specs/tests.md`
- **Contrast Checker Utility:** `src/utils/contrast-checker.js`

### External References

- [WCAG 2.2 Contrast Requirements](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [CSS Custom Properties (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)
- [Design Tokens W3C Spec](https://www.w3.org/community/design-tokens/)
- [Accessible Color Palettes](https://www.accessible-colors.com/)

---

**Questions or issues?** Check the [Troubleshooting](#troubleshooting) section or review the specification documents.
