/**
 * Fuzzy Search Utility
 * Lightweight fuzzy search implementation for plugin matching
 */

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Distance between strings
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  
  // Handle empty strings
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Check if query matches using fuzzy logic
 * @param {string} query - Search query
 * @param {string} target - Target string to match against
 * @param {number} threshold - Maximum distance for a match (default: 3)
 * @returns {number} - Match score (lower is better, -1 if no match)
 */
function fuzzyMatch(query, target, threshold = 3) {
  if (!query || !target) return -1;
  
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  
  // Exact match
  if (targetLower === queryLower) return 0;
  
  // Contains match
  if (targetLower.includes(queryLower)) return 1;
  
  // Starts with match
  if (targetLower.startsWith(queryLower)) return 0.5;
  
  // Check each word in target
  const targetWords = targetLower.split(/\s+/);
  for (const word of targetWords) {
    if (word.startsWith(queryLower)) return 1.5;
    if (word.includes(queryLower)) return 2;
  }
  
  // Fuzzy matching with Levenshtein distance
  // Check if query is short enough for fuzzy matching
  if (queryLower.length >= 3) {
    // Check against full target
    const distance = levenshteinDistance(queryLower, targetLower);
    if (distance <= threshold) {
      return 3 + distance;
    }
    
    // Check against each word
    for (const word of targetWords) {
      const wordDistance = levenshteinDistance(queryLower, word);
      if (wordDistance <= threshold) {
        return 4 + wordDistance;
      }
    }
  }
  
  // Check character sequence matching
  let queryIndex = 0;
  for (let i = 0; i < targetLower.length && queryIndex < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIndex]) {
      queryIndex++;
    }
  }
  
  // All query characters found in sequence
  if (queryIndex === queryLower.length) {
    return 5 + (targetLower.length - queryLower.length) / 10;
  }
  
  return -1; // No match
}

/**
 * Search plugins with fuzzy matching
 * @param {Array} plugins - Array of plugin objects
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array} - Sorted array of matching plugins
 */
export function fuzzySearchPlugins(plugins, query, options = {}) {
  const {
    keys = ['name', 'description', 'author', 'tags'],
    threshold = 3,
    limit = 100
  } = options;
  
  if (!query || query.trim().length === 0) {
    return plugins;
  }
  
  const results = [];
  
  for (const plugin of plugins) {
    let bestScore = -1;
    let matchedField = null;
    
    // Check each searchable field
    for (const key of keys) {
      let value = plugin[key];
      
      if (!value) continue;
      
      // Handle arrays (like tags)
      if (Array.isArray(value)) {
        value = value.join(' ');
      }
      
      const score = fuzzyMatch(query, String(value), threshold);
      
      if (score >= 0 && (bestScore === -1 || score < bestScore)) {
        bestScore = score;
        matchedField = key;
      }
    }
    
    if (bestScore >= 0) {
      results.push({
        item: plugin,
        score: bestScore,
        matchedField
      });
    }
  }
  
  // Sort by score (lower is better)
  results.sort((a, b) => a.score - b.score);
  
  // Apply limit and extract items
  return results
    .slice(0, limit)
    .map(result => result.item);
}

/**
 * Highlight matching parts in text
 * @param {string} text - Text to highlight
 * @param {string} query - Search query
 * @returns {string} - HTML string with highlighted matches
 */
export function highlightMatches(text, query) {
  if (!query || !text) return text;
  
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  
  // Find all matching positions
  const matches = [];
  let index = textLower.indexOf(queryLower);
  
  while (index !== -1) {
    matches.push({
      start: index,
      end: index + query.length
    });
    index = textLower.indexOf(queryLower, index + 1);
  }
  
  if (matches.length === 0) return text;
  
  // Build highlighted string
  let result = '';
  let lastIndex = 0;
  
  for (const match of matches) {
    result += text.slice(lastIndex, match.start);
    result += `<mark class="fuzzy-highlight">${text.slice(match.start, match.end)}</mark>`;
    lastIndex = match.end;
  }
  
  result += text.slice(lastIndex);
  
  return result;
}

// Export for use in PluginContext
export default {
  fuzzySearchPlugins,
  highlightMatches,
  fuzzyMatch
};