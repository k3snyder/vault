/**
 * Design Token System - Color Definitions
 *
 * This file defines the complete color system for Vault using a three-layer architecture:
 * 1. Color Scales - Base color palettes (neutral, primary, status colors)
 * 2. Semantic Tokens - Purpose-driven tokens (bgPrimary, textSecondary, etc.)
 * 3. CSS Variables - Applied via css-generator.js for component consumption
 *
 * Key Principles:
 * - Primary color is BLUE (#3b82f6 family), not purple
 * - All text colors must meet WCAG AA contrast requirements (4.5:1 minimum)
 * - Semantic tokens describe purpose, not appearance
 * - Dark theme uses inverted values from light theme
 *
 * @module tokens/colors
 * @version 1.0.0
 */

// ============================================================================
// Layer 1: Color Scales
// ============================================================================

/**
 * Neutral gray scale - Used for text, backgrounds, and borders
 * Updated neutral-500 to #737373 for WCAG AA compliance (5.5:1 contrast on white)
 */
export const neutral = {
  50:  '#fafafa',
  100: '#f5f5f5',
  200: '#e5e5e5',
  300: '#d4d4d4',
  400: '#a3a3a3',
  500: '#737373',  // WCAG compliant tertiary text (was #999999 at 2.8:1)
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  950: '#0a0a0a'
};

/**
 * Primary brand color scale - BLUE (explicitly requested, not purple/indigo)
 * Base: #3b82f6 (blue-500)
 */
export const primary = {
  50:  '#eff6ff',
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#60a5fa',
  500: '#3b82f6',  // Base blue
  600: '#2563eb',  // Primary accent
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',
  950: '#172554'
};

/**
 * Success color scale - Green
 */
export const success = {
  50:  '#f0fdf4',
  100: '#dcfce7',
  200: '#bbf7d0',
  300: '#86efac',
  400: '#4ade80',
  500: '#22c55e',
  600: '#16a34a',
  700: '#15803d',
  800: '#166534',
  900: '#14532d',
  950: '#052e16'
};

/**
 * Warning color scale - Amber
 */
export const warning = {
  50:  '#fffbeb',
  100: '#fef3c7',
  200: '#fde68a',
  300: '#fcd34d',
  400: '#fbbf24',
  500: '#f59e0b',
  600: '#d97706',
  700: '#b45309',
  800: '#92400e',
  900: '#78350f',
  950: '#451a03'
};

/**
 * Error color scale - Red
 */
export const error = {
  50:  '#fef2f2',
  100: '#fee2e2',
  200: '#fecaca',
  300: '#fca5a5',
  400: '#f87171',
  500: '#ef4444',
  600: '#dc2626',
  700: '#b91c1c',
  800: '#991b1b',
  900: '#7f1d1d',
  950: '#450a0a'
};

/**
 * Info color scale - Blue (matches primary for consistency)
 */
export const info = {
  50:  '#eff6ff',
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#60a5fa',
  500: '#3b82f6',
  600: '#2563eb',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',
  950: '#172554'
};

// ============================================================================
// Layer 2: Semantic Tokens
// ============================================================================

/**
 * Light theme semantic tokens
 * Maps semantic names to specific color values
 *
 * Apple Design Principles - Four-Layer Hierarchy:
 * - Layer 0 (Content): Highest visual priority - editor content, reading pane
 * - Layer 1 (Primary Chrome): Sidebars, navigation - defers to content
 * - Layer 2 (Secondary Chrome): Status bars, tabs, toolbars - lower priority
 * - Layer 3 (Tertiary Chrome): Dividers, subtle borders - near-invisible structure
 */
export const lightTheme = {
  // === LAYER 0: CONTENT ===
  // The actual content the user is creating/reading
  // Highest visual importance - should have maximum contrast and clarity
  contentBg: '#ffffff',
  contentText: neutral[900],
  contentTextSecondary: neutral[700],
  contentSelection: primary[200],
  contentCursor: neutral[900],

  // === LAYER 1: PRIMARY CHROME ===
  // Navigation, sidebars - supports content but defers to it
  chromePrimaryBg: neutral[50],
  chromePrimaryText: neutral[700],
  chromePrimaryTextMuted: neutral[500],
  chromePrimaryBorder: neutral[200],

  // === LAYER 2: SECONDARY CHROME ===
  // Status bars, tabs, toolbars - contextual information
  chromeSecondaryBg: neutral[100],
  chromeSecondaryText: neutral[600],
  chromeSecondaryBorder: neutral[200], // Slightly more visible than primary chrome

  // === LAYER 3: TERTIARY CHROME ===
  // Dividers, subtle borders - near-invisible structural elements
  chromeTertiary: neutral[200],
  chromeTertiarySubtle: neutral[100],

  // === FILL TOKENS (Interactive Backgrounds) ===
  // Apple's four-level fill hierarchy for interactive element backgrounds
  // Purpose: Provides consistent hover/selected/pressed states across all UI
  fillPrimary: 'rgba(0, 0, 0, 0.05)',       // Hover states, selected items
  fillSecondary: 'rgba(0, 0, 0, 0.03)',     // Subtle backgrounds, zebra striping
  fillTertiary: 'rgba(0, 0, 0, 0.02)',      // Very subtle, background hints
  fillQuaternary: 'rgba(0, 0, 0, 0.01)',    // Near-invisible, skeleton loaders
  fillHover: 'rgba(0, 0, 0, 0.05)',         // Alias for fillPrimary
  fillSelected: 'rgba(0, 0, 0, 0.05)',      // Alias for fillPrimary
  fillPressed: 'rgba(0, 0, 0, 0.08)',       // Higher opacity for pressed states
  fillDisabled: 'rgba(0, 0, 0, 0.02)',      // Alias for fillTertiary

  // === CONTEXT-AWARE BACKGROUNDS ===
  /**
   * Purpose-driven background colors for different user task contexts.
   * These backgrounds serve functional purposes, not aesthetic preferences:
   *
   * - bgWriting: Warm tint reduces eye strain during extended authoring sessions
   * - bgReading: Neutral white optimizes comprehension for technical content
   * - bgPreview: Matches web output context for WYSIWYG accuracy
   *
   * Note: Token definition is in scope; UI toggle for activation is future work.
   */
  bgWriting: '#FDFCFA',    // Warm: reduces eye strain for long writing sessions
  bgReading: '#FFFFFF',    // Neutral: optimal for comprehension and clarity
  bgPreview: '#FFFFFF',    // Matches web output for accurate preview

  // === TRANSLUCENT BACKGROUNDS ===
  /**
   * Translucent background tokens for native desktop vibrancy effects.
   *
   * These backgrounds require backdrop-filter CSS property for full effect.
   * The blur and saturation effects are defined in component CSS, not in tokens.
   * Fallback to solid backgrounds is handled via @supports not (backdrop-filter).
   *
   * Alpha values between 0.85-0.92 provide ideal balance of translucency while
   * maintaining text legibility and WCAG AA contrast compliance.
   */
  bgTranslucentLight: 'rgba(250, 250, 250, 0.85)',  // Translucent chrome surfaces
  bgTranslucentOverlay: 'rgba(255, 255, 255, 0.92)', // Higher opacity for overlays

  // Backgrounds (Legacy - gradually migrate to layer-based tokens)
  bgPrimary: '#ffffff',
  bgSecondary: neutral[50],
  bgTertiary: neutral[100],
  bgElevated: '#ffffff',
  bgHover: neutral[100],
  bgActive: neutral[200],

  // Text
  textPrimary: neutral[900],
  textSecondary: neutral[700],
  textTertiary: neutral[500],  // #737373 - WCAG AA compliant
  textDisabled: neutral[400],
  textInverse: '#ffffff',

  // Borders
  borderPrimary: neutral[200],
  borderSecondary: neutral[100],
  borderFocus: primary[600],

  // Accent colors
  accentPrimary: primary[600],
  accentHover: primary[700],
  accentActive: primary[800],
  accentBg: primary[50],

  // Status colors
  successText: success[700],
  successBg: success[50],
  successBorder: success[300],

  warningText: warning[700],
  warningBg: warning[50],
  warningBorder: warning[300],

  errorText: error[700],
  errorBg: error[50],
  errorBorder: error[300],

  infoText: info[700],
  infoBg: info[50],
  infoBorder: info[300],

  // Editor-specific
  editorBg: '#ffffff',
  editorText: neutral[900],
  editorSelection: primary[200],
  editorSelectionMatch: 'rgba(191, 219, 254, 0.4)', // primary-200 with opacity
  editorCursor: '#000000',
  editorLineNumber: neutral[600],
  editorLineNumberActive: neutral[900],
  editorActiveLine: 'rgba(59, 130, 246, 0.05)', // primary-500 with low opacity
  editorGutter: neutral[50],
  editorMatchingBracket: primary[100],

  // Syntax highlighting (GitHub-inspired, NO purple)
  syntaxKeyword: '#d73a49',      // Red
  syntaxString: '#032f62',       // Dark blue
  syntaxNumber: '#005cc5',       // Blue
  syntaxComment: '#6a737d',      // Gray
  syntaxFunction: '#0550ae',     // Blue (NOT purple)
  syntaxVariable: '#e36209',     // Orange
  syntaxType: '#22863a',         // Green
  syntaxOperator: '#d73a49',     // Red
  syntaxPunctuation: '#24292e',  // Near black
  syntaxTag: '#22863a',          // Green
  syntaxAttribute: '#0550ae',    // Blue (NOT purple)
  syntaxBracket: '#586e75',      // Gray-blue

  // Links
  linkColor: primary[600],
  linkHover: primary[700],
  linkVisited: primary[800],

  // WikiLinks
  wikilinkValid: '#2e6da4',      // Blue
  wikilinkValidBg: 'rgba(46, 109, 164, 0.1)',
  wikilinkBroken: error[600],
  wikilinkBrokenBg: 'rgba(220, 38, 38, 0.1)',

  // Shadows
  shadowSm: 'rgba(0, 0, 0, 0.05)',
  shadowMd: 'rgba(0, 0, 0, 0.1)',
  shadowLg: 'rgba(0, 0, 0, 0.15)',

  // Focus ring
  focusRing: primary[600],
  focusRingOffset: '#ffffff'
};

/**
 * Dark theme semantic tokens
 * Inverted values from light theme for dark backgrounds
 *
 * Apple Design Principles - Progressive Lightening in Dark Mode:
 * Each elevation level gets progressively lighter (#1C1C1E → #2C2C2E → #3A3A3C → #48484A)
 * Blue undertone (#1C1C1E vs pure #1C1C1C) creates more alive feeling
 */
export const darkTheme = {
  // === LAYER 0: CONTENT ===
  // Content layer in dark mode - highest contrast for readability
  contentBg: neutral[900],
  contentText: '#F5F5F7',              // Apple label (dark) - 15.4:1 contrast
  contentTextSecondary: '#A1A1A6',     // Apple secondaryLabel - 6.3:1 contrast
  contentSelection: 'rgba(96, 165, 250, 0.3)', // primary-400 with opacity
  contentCursor: '#60a5fa',            // Blue cursor for visibility

  // === LAYER 1: PRIMARY CHROME ===
  // Sidebars, navigation - Apple's elevated surface pattern
  chromePrimaryBg: '#2C2C2E',          // Apple secondarySystemBackground
  chromePrimaryText: '#A1A1A6',        // Deferred text contrast
  chromePrimaryTextMuted: '#6E6E73',   // Apple tertiaryLabel
  chromePrimaryBorder: 'rgba(255, 255, 255, 0.08)', // Subtle border

  // === LAYER 2: SECONDARY CHROME ===
  // Further elevated surfaces - status bars, tabs
  chromeSecondaryBg: '#3A3A3C',        // Apple tertiarySystemBackground
  chromeSecondaryText: '#8E8E93',      // Reduced contrast
  chromeSecondaryBorder: 'rgba(255, 255, 255, 0.06)', // Even more subtle

  // === LAYER 3: TERTIARY CHROME ===
  // Highest elevation - tooltips, overlays, subtle dividers
  chromeTertiary: 'rgba(255, 255, 255, 0.08)',
  chromeTertiarySubtle: 'rgba(255, 255, 255, 0.04)',

  // === FILL TOKENS (Interactive Backgrounds) ===
  // Apple's four-level fill hierarchy for dark mode
  // Note: Higher opacity values needed for visibility on dark backgrounds
  fillPrimary: 'rgba(255, 255, 255, 0.08)',     // Hover states, selected items
  fillSecondary: 'rgba(255, 255, 255, 0.05)',   // Subtle backgrounds
  fillTertiary: 'rgba(255, 255, 255, 0.03)',    // Very subtle hints
  fillQuaternary: 'rgba(255, 255, 255, 0.02)',  // Near-invisible
  fillHover: 'rgba(255, 255, 255, 0.08)',       // Alias for fillPrimary
  fillSelected: 'rgba(255, 255, 255, 0.08)',    // Alias for fillPrimary
  fillPressed: 'rgba(255, 255, 255, 0.12)',     // Higher opacity for pressed states
  fillDisabled: 'rgba(255, 255, 255, 0.03)',    // Alias for fillTertiary

  // === CONTEXT-AWARE BACKGROUNDS ===
  /**
   * Context backgrounds in dark mode all use Apple's systemBackground (#1C1C1E).
   * The blue undertone creates a more alive feeling than pure neutral (#1C1C1C).
   */
  bgWriting: '#1C1C1E',    // Apple systemBackground with blue undertone
  bgReading: '#1C1C1E',    // Same as writing - context distinction less relevant in dark mode
  bgPreview: '#1C1C1E',    // Matches dark theme web output

  // === TRANSLUCENT BACKGROUNDS ===
  /**
   * Translucent backgrounds for dark mode use darker rgba values with white component.
   * These create vibrancy effects when backdrop-filter is supported.
   */
  bgTranslucentDark: 'rgba(30, 30, 30, 0.85)',   // Translucent chrome surfaces
  bgTranslucentOverlay: 'rgba(40, 40, 40, 0.92)', // Higher opacity for overlays

  // Backgrounds (Legacy - inverted darker values)
  bgPrimary: neutral[950],
  bgSecondary: neutral[900],
  bgTertiary: neutral[800],
  bgElevated: neutral[900],
  bgHover: neutral[800],
  bgActive: neutral[700],

  // Text (inverted - lighter values)
  textPrimary: neutral[50],
  textSecondary: neutral[300],
  textTertiary: neutral[400],
  textDisabled: neutral[600],
  textInverse: neutral[900],

  // Borders (darker in dark theme)
  borderPrimary: neutral[800],
  borderSecondary: neutral[900],
  borderFocus: primary[500],

  // Accent colors (slightly lighter for visibility on dark)
  accentPrimary: primary[500],
  accentHover: primary[400],
  accentActive: primary[300],
  accentBg: 'rgba(59, 130, 246, 0.1)', // primary-500 with low opacity

  // Status colors (adjusted for dark backgrounds)
  successText: success[400],
  successBg: 'rgba(34, 197, 94, 0.1)',
  successBorder: success[800],

  warningText: warning[400],
  warningBg: 'rgba(245, 158, 11, 0.1)',
  warningBorder: warning[800],

  errorText: error[400],
  errorBg: 'rgba(239, 68, 68, 0.1)',
  errorBorder: error[800],

  infoText: info[400],
  infoBg: 'rgba(59, 130, 246, 0.1)',
  infoBorder: info[800],

  // Editor-specific (dark theme)
  editorBg: '#1a1a1a',
  editorText: neutral[100],
  editorSelection: 'rgba(96, 165, 250, 0.3)', // primary-400 with opacity
  editorSelectionMatch: 'rgba(96, 165, 250, 0.15)',
  editorCursor: neutral[100],
  editorLineNumber: neutral[400],  // Updated from neutral[600] for WCAG AA compliance (6.90:1)
  editorLineNumberActive: neutral[300],
  editorActiveLine: 'rgba(255, 255, 255, 0.05)',
  editorGutter: neutral[950],
  editorMatchingBracket: 'rgba(59, 130, 246, 0.3)',

  // Syntax highlighting (VS Code Dark+ inspired, NO purple)
  syntaxKeyword: '#569cd6',      // Blue
  syntaxString: '#ce9178',       // Salmon
  syntaxNumber: '#b5cea8',       // Light green
  syntaxComment: '#6a9955',      // Green
  syntaxFunction: '#dcdcaa',     // Yellow
  syntaxVariable: '#9cdcfe',     // Light blue
  syntaxType: '#4ec9b0',         // Teal
  syntaxOperator: '#d4d4d4',     // Light gray
  syntaxPunctuation: '#d4d4d4',  // Light gray
  syntaxTag: '#569cd6',          // Blue
  syntaxAttribute: '#9cdcfe',    // Light blue
  syntaxBracket: '#808080',      // Gray

  // Links (lighter for dark backgrounds)
  linkColor: primary[400],
  linkHover: primary[300],
  linkVisited: primary[500],

  // WikiLinks (dark theme)
  wikilinkValid: '#4fc3f7',      // Light blue
  wikilinkValidBg: 'rgba(79, 195, 247, 0.15)',
  wikilinkBroken: error[400],
  wikilinkBrokenBg: 'rgba(248, 113, 113, 0.15)',

  // Shadows (lighter for dark theme)
  shadowSm: 'rgba(0, 0, 0, 0.3)',
  shadowMd: 'rgba(0, 0, 0, 0.4)',
  shadowLg: 'rgba(0, 0, 0, 0.5)',

  // Focus ring (lighter for visibility)
  focusRing: primary[500],
  focusRingOffset: neutral[950]
};

/**
 * Priority colors for task widget
 * Separate from semantic tokens for explicit task priority styling
 */
export const priorities = {
  light: {
    high: {
      text: error[700],
      bg: error[50],
      border: error[300]
    },
    medium: {
      text: warning[700],
      bg: warning[50],
      border: warning[300]
    },
    low: {
      text: info[700],
      bg: info[50],
      border: info[300]
    }
  },
  dark: {
    high: {
      text: error[400],
      bg: 'rgba(239, 68, 68, 0.1)',
      border: error[800]
    },
    medium: {
      text: warning[400],
      bg: 'rgba(245, 158, 11, 0.1)',
      border: warning[800]
    },
    low: {
      text: info[400],
      bg: 'rgba(59, 130, 246, 0.1)',
      border: info[800]
    }
  }
};

// ============================================================================
// Exports
// ============================================================================

/**
 * Default export containing all token collections
 */
export default {
  // Color scales
  neutral,
  primary,
  success,
  warning,
  error,
  info,

  // Semantic themes
  lightTheme,
  darkTheme,

  // Priority colors
  priorities
};
