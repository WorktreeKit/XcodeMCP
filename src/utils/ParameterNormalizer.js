export class ParameterNormalizer {
  
  static normalizeDestinationName(destination) {
    if (!destination || typeof destination !== 'string') {
      return destination;
    }
    
    // Remove extra whitespace and normalize case
    let normalized = destination.trim();
    
    // Common destination name variations
    const destinationMappings = {
      // iPhone variants
      'iphone': 'iPhone',
      'iphone-15': 'iPhone 15',
      'iphone-15-pro': 'iPhone 15 Pro',
      'iphone-15-pro-max': 'iPhone 15 Pro Max',
      'iphone-16': 'iPhone 16',
      'iphone-16-pro': 'iPhone 16 Pro',
      'iphone-16-pro-max': 'iPhone 16 Pro Max',
      'iphone-14': 'iPhone 14',
      'iphone-14-pro': 'iPhone 14 Pro',
      'iphone-14-pro-max': 'iPhone 14 Pro Max',
      'iphone-13': 'iPhone 13',
      'iphone-13-pro': 'iPhone 13 Pro',
      'iphone-13-pro-max': 'iPhone 13 Pro Max',
      
      // iPad variants
      'ipad': 'iPad',
      'ipad-air': 'iPad Air',
      'ipad-pro': 'iPad Pro',
      'ipad-mini': 'iPad mini',
      
      // Simulator variants
      'simulator': 'Simulator',
      'sim': 'Simulator',
      
      // Mac variants
      'mac': 'Mac',
      'my-mac': 'My Mac',
      'mymac': 'My Mac',
    };
    
    // Try exact mapping first
    const lowerNormalized = normalized.toLowerCase();
    if (destinationMappings[lowerNormalized]) {
      return destinationMappings[lowerNormalized];
    }
    
    // Try pattern matching for simulator names
    if (lowerNormalized.includes('simulator')) {
      // Handle "iPhone 15 Simulator" -> keep as is but normalize spacing
      normalized = normalized.replace(/\s+/g, ' ').trim();
      return normalized;
    }
    
    // Handle dash/underscore to space conversion for device names
    if (lowerNormalized.includes('-') || lowerNormalized.includes('_')) {
      normalized = normalized
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Capitalize words appropriately
      normalized = this._capitalizeDeviceName(normalized);
    }
    
    return normalized;
  }
  
  static normalizeSchemeName(schemeName) {
    if (!schemeName || typeof schemeName !== 'string') {
      return schemeName;
    }
    
    // Remove extra whitespace
    let normalized = schemeName.trim();
    
    // Common scheme name patterns
    const schemeMappings = {
      // Test scheme variants
      'test': 'Tests',
      'tests': 'Tests',
      'unit-test': 'UnitTests',
      'unit-tests': 'UnitTests',
      'unittests': 'UnitTests',
      'integration-test': 'IntegrationTests',
      'integration-tests': 'IntegrationTests',
      'integrationtests': 'IntegrationTests',
      
      // Debug/Release variants
      'debug': 'Debug',
      'release': 'Release',
      'prod': 'Release',
      'production': 'Release',
      'dev': 'Debug',
      'development': 'Debug',
    };
    
    const lowerNormalized = normalized.toLowerCase();
    if (schemeMappings[lowerNormalized]) {
      return schemeMappings[lowerNormalized];
    }
    
    // Handle dash/underscore to space conversion, but preserve original casing
    if (normalized.includes('-') || normalized.includes('_')) {
      // Don't modify case for scheme names as they're often project-specific
      normalized = normalized.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    
    return normalized;
  }
  
  static _capitalizeDeviceName(name) {
    const words = name.split(' ');
    return words.map(word => {
      const lower = word.toLowerCase();
      
      // Special cases
      if (lower === 'iphone') return 'iPhone';
      if (lower === 'ipad') return 'iPad';
      if (lower === 'mac') return 'Mac';
      if (lower === 'pro') return 'Pro';
      if (lower === 'max') return 'Max';
      if (lower === 'mini') return 'mini';
      if (lower === 'air') return 'Air';
      if (lower === 'simulator') return 'Simulator';
      
      // Numbers stay as-is
      if (/^\d+$/.test(word)) return word;
      
      // Default capitalization
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
  }
  
  // Fuzzy matching for when exact normalization doesn't work
  static findBestMatch(input, availableOptions) {
    if (!input || !availableOptions || !Array.isArray(availableOptions)) {
      return null;
    }
    
    const normalized = input.toLowerCase().trim();
    
    // Try exact match first
    const exactMatch = availableOptions.find(option => 
      option.toLowerCase() === normalized
    );
    if (exactMatch) return exactMatch;
    
    // Try partial match
    const partialMatches = availableOptions.filter(option =>
      option.toLowerCase().includes(normalized) || 
      normalized.includes(option.toLowerCase())
    );
    
    if (partialMatches.length === 1) {
      return partialMatches[0];
    }
    
    // Try fuzzy matching for common typos
    const fuzzyMatches = availableOptions.filter(option => {
      const optionLower = option.toLowerCase();
      return this._calculateSimilarity(normalized, optionLower) > 0.7;
    });
    
    if (fuzzyMatches.length === 1) {
      return fuzzyMatches[0];
    }
    
    return null;
  }
  
  static _calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) {
      return 1.0;
    }
    
    const editDistance = this._levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }
  
  static _levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }
}