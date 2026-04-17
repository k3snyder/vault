/**
 * Lucide Icon Utility
 * Bundled SVG icons for Vault - no external dependencies
 * Icons sourced from Lucide (https://lucide.dev) under ISC license
 */

// Import SVG content (Vite handles ?raw imports)
import alertCircleSvg from './lucide/alert-circle.svg?raw';
import alertTriangleSvg from './lucide/alert-triangle.svg?raw';
import arrowDownSvg from './lucide/arrow-down.svg?raw';
import arrowUpSvg from './lucide/arrow-up.svg?raw';
import botSvg from './lucide/bot.svg?raw';
import calendarSvg from './lucide/calendar.svg?raw';
import calendarDaysSvg from './lucide/calendar-days.svg?raw';
import catSvg from './lucide/cat.svg?raw';
import checkSvg from './lucide/check.svg?raw';
import checkCircleSvg from './lucide/check-circle.svg?raw';
import chevronDownSvg from './lucide/chevron-down.svg?raw';
import chevronLeftSvg from './lucide/chevron-left.svg?raw';
import chevronRightSvg from './lucide/chevron-right.svg?raw';
import circleSvg from './lucide/circle.svg?raw';
import clipboardListSvg from './lucide/clipboard-list.svg?raw';
import cloudSvg from './lucide/cloud.svg?raw';
import columns2Svg from './lucide/columns-2.svg?raw';
import copySvg from './lucide/copy.svg?raw';
import downloadSvg from './lucide/download.svg?raw';
import editSvg from './lucide/edit.svg?raw';
import externalLinkSvg from './lucide/external-link.svg?raw';
import eyeSvg from './lucide/eye.svg?raw';
import fileSvg from './lucide/file.svg?raw';
import fileTextSvg from './lucide/file-text.svg?raw';
import folderSvg from './lucide/folder.svg?raw';
import folderOpenSvg from './lucide/folder-open.svg?raw';
import gemSvg from './lucide/gem.svg?raw';
import helpCircleSvg from './lucide/help-circle.svg?raw';
import houseSvg from './lucide/house.svg?raw';
import infoSvg from './lucide/info.svg?raw';
import layoutGridSvg from './lucide/layout-grid.svg?raw';
import lightbulbSvg from './lucide/lightbulb.svg?raw';
import listTodoSvg from './lucide/list-todo.svg?raw';
import loader2Svg from './lucide/loader-2.svg?raw';
import lockSvg from './lucide/lock.svg?raw';
import menuSvg from './lucide/menu.svg?raw';
import messageCircleSvg from './lucide/message-circle.svg?raw';
import messageSquareSvg from './lucide/message-square.svg?raw';
import monitorSvg from './lucide/monitor.svg?raw';
import moonSvg from './lucide/moon.svg?raw';
import moreHorizontalSvg from './lucide/more-horizontal.svg?raw';
import moreVerticalSvg from './lucide/more-vertical.svg?raw';
import moveSvg from './lucide/move.svg?raw';
import panelLeftSvg from './lucide/panel-left.svg?raw';
import pencilLineSvg from './lucide/pencil-line.svg?raw';
import plusSvg from './lucide/plus.svg?raw';
import refreshCwSvg from './lucide/refresh-cw.svg?raw';
import rocketSvg from './lucide/rocket.svg?raw';
import searchSvg from './lucide/search.svg?raw';
import sendSvg from './lucide/send.svg?raw';
import settingsSvg from './lucide/settings.svg?raw';
import starSvg from './lucide/star.svg?raw';
import sunSvg from './lucide/sun.svg?raw';
import terminalSvg from './lucide/terminal.svg?raw';
import trash2Svg from './lucide/trash-2.svg?raw';
import xSvg from './lucide/x.svg?raw';
import zapSvg from './lucide/zap.svg?raw';
import clockSvg from './lucide/clock.svg?raw';
import aArrowDownSvg from './lucide/a-arrow-down.svg?raw';
import packageSvg from './lucide/package.svg?raw';
import chartBarSvg from './lucide/chart-bar.svg?raw';
import filePlusSvg from './lucide/file-plus.svg?raw';
import brainSvg from './lucide/brain.svg?raw';
import sparklesSvg from './lucide/sparkles.svg?raw';
import messageCircleCodeSvg from './lucide/message-circle-code.svg?raw';
import fileLockSvg from './lucide/file-lock.svg?raw';
import lockKeyholeSvg from './lucide/lock-keyhole.svg?raw';
import yinYangSvg from './lucide/yin-yang.svg?raw';

// SVG cache mapping icon names to raw SVG strings
const svgCache = {
  'alert-circle': alertCircleSvg,
  'alert-triangle': alertTriangleSvg,
  'arrow-down': arrowDownSvg,
  'arrow-up': arrowUpSvg,
  'bot': botSvg,
  'calendar': calendarSvg,
  'calendar-days': calendarDaysSvg,
  'cat': catSvg,
  'check': checkSvg,
  'check-circle': checkCircleSvg,
  'chevron-down': chevronDownSvg,
  'chevron-left': chevronLeftSvg,
  'chevron-right': chevronRightSvg,
  'circle': circleSvg,
  'clipboard-list': clipboardListSvg,
  'cloud': cloudSvg,
  'columns-2': columns2Svg,
  'copy': copySvg,
  'download': downloadSvg,
  'edit': editSvg,
  'external-link': externalLinkSvg,
  'eye': eyeSvg,
  'file': fileSvg,
  'file-text': fileTextSvg,
  'folder': folderSvg,
  'folder-open': folderOpenSvg,
  'gem': gemSvg,
  'help-circle': helpCircleSvg,
  'house': houseSvg,
  'info': infoSvg,
  'layout-grid': layoutGridSvg,
  'lightbulb': lightbulbSvg,
  'list-todo': listTodoSvg,
  'loader-2': loader2Svg,
  'lock': lockSvg,
  'menu': menuSvg,
  'message-circle': messageCircleSvg,
  'message-square': messageSquareSvg,
  'monitor': monitorSvg,
  'moon': moonSvg,
  'more-horizontal': moreHorizontalSvg,
  'more-vertical': moreVerticalSvg,
  'move': moveSvg,
  'panel-left': panelLeftSvg,
  'pencil-line': pencilLineSvg,
  'plus': plusSvg,
  'refresh-cw': refreshCwSvg,
  'rocket': rocketSvg,
  'search': searchSvg,
  'send': sendSvg,
  'settings': settingsSvg,
  'star': starSvg,
  'sun': sunSvg,
  'terminal': terminalSvg,
  'trash-2': trash2Svg,
  'x': xSvg,
  'zap': zapSvg,
  'clock': clockSvg,
  'a-arrow-down': aArrowDownSvg,
  'package': packageSvg,
  'chart-bar': chartBarSvg,
  'file-plus': filePlusSvg,
  'brain': brainSvg,
  'sparkles': sparklesSvg,
  'message-circle-code': messageCircleCodeSvg,
  'file-lock': fileLockSvg,
  'lock-keyhole': lockKeyholeSvg,
  'yin-yang': yinYangSvg,
};

/**
 * Generate an SVG string with custom attributes
 * @param {string} name - Icon name (e.g., 'search', 'plus', 'chevron-left')
 * @param {Object} options - Customization options
 * @param {number} [options.size=16] - Icon size in pixels
 * @param {string} [options.class=''] - CSS class(es) to add
 * @param {string} [options.ariaLabel] - Accessible label (makes icon non-decorative)
 * @param {number} [options.strokeWidth] - Override stroke width (default 2)
 * @returns {string} SVG string ready for insertion into HTML
 */
export function icon(name, options = {}) {
  const svg = svgCache[name];
  if (!svg) {
    console.warn(`Icon "${name}" not found`);
    return '';
  }

  const {
    size = 16,
    class: className = '',
    ariaLabel,
    strokeWidth
  } = options;

  // Build the modified SVG
  let result = svg
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);

  // Add class and accessibility attributes
  const attrs = [];
  if (className) attrs.push(`class="${className}"`);
  if (ariaLabel) {
    attrs.push(`aria-label="${ariaLabel}"`);
    attrs.push('role="img"');
  } else {
    attrs.push('aria-hidden="true"');
  }

  if (attrs.length > 0) {
    result = result.replace('<svg', `<svg ${attrs.join(' ')}`);
  }

  // Override stroke width if specified
  if (strokeWidth !== undefined) {
    result = result.replace(/stroke-width="[^"]*"/, `stroke-width="${strokeWidth}"`);
  }

  return result;
}

/**
 * Convenience object with pre-bound icon functions
 * Usage: icons.search() or icons.search({ size: 20 })
 */
export const icons = {
  // Navigation
  chevronLeft: (opts) => icon('chevron-left', opts),
  chevronRight: (opts) => icon('chevron-right', opts),
  chevronDown: (opts) => icon('chevron-down', opts),
  menu: (opts) => icon('menu', opts),
  panelLeft: (opts) => icon('panel-left', opts),
  house: (opts) => icon('house', opts),
  listTodo: (opts) => icon('list-todo', opts),
  pencilLine: (opts) => icon('pencil-line', opts),

  // Actions
  plus: (opts) => icon('plus', opts),
  close: (opts) => icon('x', opts),
  x: (opts) => icon('x', opts),
  copy: (opts) => icon('copy', opts),
  star: (opts) => icon('star', opts),
  edit: (opts) => icon('edit', opts),
  trash: (opts) => icon('trash-2', opts),
  download: (opts) => icon('download', opts),
  externalLink: (opts) => icon('external-link', opts),
  move: (opts) => icon('move', opts),

  // Search & View
  search: (opts) => icon('search', opts),
  eye: (opts) => icon('eye', opts),
  lock: (opts) => icon('lock', opts),
  refresh: (opts) => icon('refresh-cw', opts),

  // Mode Toggle
  messageCircle: (opts) => icon('message-circle', opts),
  terminal: (opts) => icon('terminal', opts),
  messageSquare: (opts) => icon('message-square', opts),

  // Tasks
  clipboardList: (opts) => icon('clipboard-list', opts),
  calendar: (opts) => icon('calendar', opts),
  calendarDays: (opts) => icon('calendar-days', opts),
  alertTriangle: (opts) => icon('alert-triangle', opts),
  helpCircle: (opts) => icon('help-circle', opts),
  check: (opts) => icon('check', opts),
  circle: (opts) => icon('circle', opts),
  checkCircle: (opts) => icon('check-circle', opts),

  // AI Providers
  bot: (opts) => icon('bot', opts),
  gem: (opts) => icon('gem', opts),
  cat: (opts) => icon('cat', opts),
  monitor: (opts) => icon('monitor', opts),
  cloud: (opts) => icon('cloud', opts),

  // Layout
  columns2: (opts) => icon('columns-2', opts),
  moon: (opts) => icon('moon', opts),
  sun: (opts) => icon('sun', opts),
  layoutGrid: (opts) => icon('layout-grid', opts),
  settings: (opts) => icon('settings', opts),

  // Status
  loader: (opts) => icon('loader-2', { ...opts, class: `${opts?.class || ''} icon-spin`.trim() }),
  alertCircle: (opts) => icon('alert-circle', opts),
  info: (opts) => icon('info', opts),

  // Files
  file: (opts) => icon('file', opts),
  fileText: (opts) => icon('file-text', opts),
  folder: (opts) => icon('folder', opts),
  folderOpen: (opts) => icon('folder-open', opts),

  // Misc
  send: (opts) => icon('send', opts),
  arrowUp: (opts) => icon('arrow-up', opts),
  arrowDown: (opts) => icon('arrow-down', opts),
  moreHorizontal: (opts) => icon('more-horizontal', opts),
  moreVertical: (opts) => icon('more-vertical', opts),
  zap: (opts) => icon('zap', opts),
  lightbulb: (opts) => icon('lightbulb', opts),
  rocket: (opts) => icon('rocket', opts),
  clock: (opts) => icon('clock', opts),
  aArrowDown: (opts) => icon('a-arrow-down', opts),
  package: (opts) => icon('package', opts),
  chartBar: (opts) => icon('chart-bar', opts),
  filePlus: (opts) => icon('file-plus', opts),
  brain: (opts) => icon('brain', opts),
  sparkles: (opts) => icon('sparkles', opts),
  messageCircleCode: (opts) => icon('message-circle-code', opts),
  fileLock: (opts) => icon('file-lock', opts),
  lockKeyhole: (opts) => icon('lock-keyhole', opts),
  yinYang: (opts) => icon('yin-yang', opts),
};

export default icons;
