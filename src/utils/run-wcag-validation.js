#!/usr/bin/env node

/**
 * WCAG AAA Validation Test Runner
 *
 * This script runs automated WCAG AAA validation tests and outputs results
 * in multiple formats (console, markdown, JSON).
 *
 * Usage:
 *   node src/utils/run-wcag-validation.js
 *   node src/utils/run-wcag-validation.js --format=markdown
 *   node src/utils/run-wcag-validation.js --format=json
 *   node src/utils/run-wcag-validation.js --output=test-results.md
 *
 * @module utils/run-wcag-validation
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  runAllValidations,
  formatResultsAsMarkdown,
  formatResultsAsJSON,
  logResultsToConsole
} from './wcag-aaa-validator.js';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const format = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'console';
const outputPath = args.find(arg => arg.startsWith('--output='))?.split('=')[1];

// Run validations
console.log('Running WCAG AAA validation tests...\n');
const results = runAllValidations();

// Output results based on format
switch (format) {
  case 'markdown':
  case 'md': {
    const markdown = formatResultsAsMarkdown(results);
    if (outputPath) {
      const fullPath = join(process.cwd(), outputPath);
      writeFileSync(fullPath, markdown, 'utf8');
      console.log(`\n✓ Results saved to: ${fullPath}\n`);
    } else {
      console.log(markdown);
    }
    break;
  }

  case 'json': {
    const json = formatResultsAsJSON(results);
    if (outputPath) {
      const fullPath = join(process.cwd(), outputPath);
      writeFileSync(fullPath, json, 'utf8');
      console.log(`\n✓ Results saved to: ${fullPath}\n`);
    } else {
      console.log(json);
    }
    break;
  }

  case 'console':
  default: {
    logResultsToConsole(results);
    if (outputPath) {
      // Save markdown by default for file output
      const markdown = formatResultsAsMarkdown(results);
      const fullPath = join(process.cwd(), outputPath);
      writeFileSync(fullPath, markdown, 'utf8');
      console.log(`Results also saved to: ${fullPath}\n`);
    }
    break;
  }
}

// Exit with error code if any tests failed
if (results.summary.failed > 0) {
  console.error(`\n❌ ${results.summary.failed} test(s) failed\n`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${results.summary.total} tests passed!\n`);
  process.exit(0);
}
