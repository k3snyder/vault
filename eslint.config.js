import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

const noUnsafeHtmlRule = (severity) => [
  severity,
  {
    selector:
      'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/] TemplateLiteral[expressions.length>0]',
    message:
      'No template interpolation into innerHTML. Build the static shell, set dynamic values via textContent.',
  },
  {
    selector:
      "CallExpression[callee.property.name='insertAdjacentHTML'] TemplateLiteral[expressions.length>0]",
    message: 'No template interpolation into insertAdjacentHTML.',
  },
];

const LEGACY_UNSAFE_HTML_FILES = [
  'src/TabBar.js',
  'src/boxnote/BoxNoteViewer.js',
  'src/chat/ChatInterface.js',
  'src/cli/OptimizedTerminalUI.js',
  'src/cli/XTermContainer.js',
  'src/components/AgentCostDisplay.js',
  'src/components/ModeToggle.js',
  'src/components/ToolUseCard.js',
  'src/components/UUIDManager.js',
  'src/components/VaultPicker.js',
  'src/csv/CsvEditor.js',
  'src/editor/markdown-editor.js',
  'src/editor/wikilink-extension.js',
  'src/html/HtmlViewer.js',
  'src/main.js',
  'src/pdf-intelligence/IntelligencePanel.js',
  'src/pdf/PDFTab.js',
  'src/plugin-hub/PluginHub.js',
  'src/plugin-hub/components/LoadingStates.js',
  'src/plugin-hub/components/Modal.js',
  'src/plugin-hub/components/PluginCard.js',
  'src/plugin-hub/components/Toast.js',
  'src/plugin-hub/tests/performance.test.js',
  'src/plugin-hub/utils/lazyLoader.js',
  'src/plugin-hub/views/DiscoverView.js',
  'src/plugin-hub/views/InstalledView.js',
  'src/plugin-hub/views/PermissionsView.js',
  'src/plugin-hub/views/ResourcesView.js',
  'src/search/GlobalSearch.js',
  'src/settings/AISettingsPanel.js',
  'src/settings/PluginSettingsPanel.js',
  'src/settings/UserSettingsPanel.js',
  'src/sketch/SketchTab.js',
  'src/tasks/TaskDashboard.js',
  'src/widgets/CalendarWidget.js',
  'src/widgets/SketchHub.js',
  'src/widgets/TaskWidget.js',
];

export default [
  {
    ignores: [
      '.docs/**',
      'dist/**',
      'node_modules/**',
      'public/**',
      'plugins/readwise/**',
      'src-tauri/**',
      'release/**',
      'coverage/**',
    ],
  },
  {
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-case-declarations': 'off',
      'no-dupe-class-members': 'off',
      'no-dupe-keys': 'off',
      'no-useless-escape': 'off',
      'no-useless-catch': 'off',
      'preserve-caught-error': 'off',
      'require-yield': 'off',
    },
  },
  {
    files: ['src/**/*.js', '__mocks__/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      'no-restricted-syntax': noUnsafeHtmlRule('error'),
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'no-unused-vars': 'off',
    },
  },
  {
    files: LEGACY_UNSAFE_HTML_FILES,
    rules: {
      'no-restricted-syntax': noUnsafeHtmlRule('warn'),
    },
  },
  {
    files: ['src/shims/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    files: ['src/**/*.test.js', 'test/**'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
  },
  prettier,
];
