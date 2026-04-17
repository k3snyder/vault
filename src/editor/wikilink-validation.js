// WikiLink Extension Validation Script
// This script validates WikiLink functionality without requiring a test framework

import { extractWikiLinks, normalizeWikiLinkName } from './wikilink-extension.js'

// Test cases for WikiLink pattern matching
const testCases = [
  // Basic syntax tests
  { input: '[[Note Name]]', expected: [{ text: 'Note Name', start: 0, end: 13, fullMatch: '[[Note Name]]' }] },
  { input: '[[Simple]]', expected: [{ text: 'Simple', start: 0, end: 10, fullMatch: '[[Simple]]' }] },
  { input: '[[Multi Word Note]]', expected: [{ text: 'Multi Word Note', start: 0, end: 19, fullMatch: '[[Multi Word Note]]' }] },
  
  // Multiple WikiLinks
  { input: 'Check [[First]] and [[Second]]', expected: [
    { text: 'First', start: 6, end: 15, fullMatch: '[[First]]' },
    { text: 'Second', start: 20, end: 30, fullMatch: '[[Second]]' }
  ]},
  
  // Special characters
  { input: '[[Café Notes]]', expected: [{ text: 'Café Notes', start: 0, end: 14, fullMatch: '[[Café Notes]]' }] },
  { input: '[[Notes (2024)]]', expected: [{ text: 'Notes (2024)', start: 0, end: 16, fullMatch: '[[Notes (2024)]]' }] },
  
  // Edge cases that should NOT match
  { input: '[[]]', expected: [] },
  { input: '[Note]', expected: [] },
  { input: '[[[Note]]]', expected: [] },
  { input: '[[Note]', expected: [] },
  { input: '[Note]]', expected: [] }
]

// Normalization test cases
const normalizationTests = [
  { input: 'Note Name', expected: 'note name' },
  { input: '  Spaced  Note  ', expected: 'spaced note' },
  { input: 'UPPERCASE', expected: 'uppercase' },
  { input: 'Mixed Case Note', expected: 'mixed case note' }
]

// Validation function
function validateWikiLinks() {
  console.log('🧪 WikiLink Extension Validation')
  console.log('='.repeat(40))
  
  let passed = 0
  let failed = 0
  
  // Test WikiLink extraction
  console.log('\n📝 Testing WikiLink Extraction...')
  
  testCases.forEach((testCase, index) => {
    try {
      const result = extractWikiLinks(testCase.input)
      const success = JSON.stringify(result) === JSON.stringify(testCase.expected)
      
      if (success) {
        console.log(`✅ Test ${index + 1}: "${testCase.input}" - PASSED`)
        passed++
      } else {
        console.log(`❌ Test ${index + 1}: "${testCase.input}" - FAILED`)
        console.log(`   Expected: ${JSON.stringify(testCase.expected)}`)
        console.log(`   Got:      ${JSON.stringify(result)}`)
        failed++
      }
    } catch (error) {
      console.log(`❌ Test ${index + 1}: "${testCase.input}" - ERROR: ${error.message}`)
      failed++
    }
  })
  
  // Test normalization
  console.log('\n🔤 Testing WikiLink Normalization...')
  
  normalizationTests.forEach((testCase, index) => {
    try {
      const result = normalizeWikiLinkName(testCase.input)
      const success = result === testCase.expected
      
      if (success) {
        console.log(`✅ Normalize ${index + 1}: "${testCase.input}" → "${result}" - PASSED`)
        passed++
      } else {
        console.log(`❌ Normalize ${index + 1}: "${testCase.input}" - FAILED`)
        console.log(`   Expected: "${testCase.expected}"`)
        console.log(`   Got:      "${result}"`)
        failed++
      }
    } catch (error) {
      console.log(`❌ Normalize ${index + 1}: "${testCase.input}" - ERROR: ${error.message}`)
      failed++
    }
  })
  
  // Test regex pattern directly
  console.log('\n🔍 Testing Regex Pattern...')
  
  const wikiLinkPattern = /(?<!\[)\[\[([^\]]+)\]\](?!\])/g
  const regexTests = [
    { input: '[[Valid]]', shouldMatch: true },
    { input: '[[Multi Word]]', shouldMatch: true },
    { input: '[[]]', shouldMatch: false },
    { input: '[Single]', shouldMatch: false },
    { input: '[[[Triple]]]', shouldMatch: false }
  ]
  
  regexTests.forEach((testCase, index) => {
    try {
      const matches = Array.from(testCase.input.matchAll(wikiLinkPattern))
      const hasMatch = matches.length > 0
      const success = hasMatch === testCase.shouldMatch
      
      if (success) {
        console.log(`✅ Regex ${index + 1}: "${testCase.input}" - PASSED`)
        passed++
      } else {
        console.log(`❌ Regex ${index + 1}: "${testCase.input}" - FAILED`)
        console.log(`   Expected match: ${testCase.shouldMatch}`)
        console.log(`   Actually matched: ${hasMatch}`)
        failed++
      }
    } catch (error) {
      console.log(`❌ Regex ${index + 1}: "${testCase.input}" - ERROR: ${error.message}`)
      failed++
    }
  })
  
  // Summary
  console.log('\n📊 Validation Summary')
  console.log('='.repeat(40))
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`)
  
  if (failed === 0) {
    console.log('\n🎉 All WikiLink tests passed! Extension is ready for integration.')
    return true
  } else {
    console.log('\n⚠️  Some tests failed. Please review the WikiLink implementation.')
    return false
  }
}

// Performance test
function performanceTest() {
  console.log('\n⚡ Performance Testing...')
  
  // Create a document with many WikiLinks
  const wikiLinks = Array.from({ length: 100 }, (_, i) => `[[Note ${i}]]`).join(' ')
  
  const startTime = Date.now()
  const results = extractWikiLinks(wikiLinks)
  const endTime = Date.now()
  
  console.log(`📏 Processed ${results.length} WikiLinks in ${endTime - startTime}ms`)
  
  if (endTime - startTime < 10) {
    console.log('✅ Performance test passed (< 10ms)')
    return true
  } else {
    console.log('⚠️  Performance test warning (>= 10ms)')
    return false
  }
}

// Run validation if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const basicTestsPassed = validateWikiLinks()
  const performanceTestPassed = performanceTest()
  
  if (basicTestsPassed && performanceTestPassed) {
    console.log('\n🚀 WikiLink Extension validation completed successfully!')
    process.exit(0)
  } else {
    console.log('\n💥 WikiLink Extension validation failed!')
    process.exit(1)
  }
}

export { validateWikiLinks, performanceTest }