const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      '*.min.js',
      '*-Mangrove-Windows.*'
    ]
  },
  // Node.js backend files
  {
    files: ['**/*.js'],
    ignores: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    rules: {
      // Possible Problems
      'no-console': 'off', // Allow console for server logging
      'no-duplicate-imports': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-use-before-define': ['error', { functions: false, classes: true }],

      // Suggestions
      'arrow-body-style': ['warn', 'as-needed'],
      'camelcase': ['warn', { properties: 'never' }],
      'curly': ['error', 'all'],
      'default-case': 'warn',
      'dot-notation': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-else-return': 'warn',
      'no-lonely-if': 'warn',
      'no-throw-literal': 'error',
      'no-unneeded-ternary': 'warn',
      'no-var': 'error',
      'object-shorthand': ['warn', 'always'],
      'prefer-arrow-callback': 'warn',
      'prefer-const': 'warn',
      'prefer-destructuring': ['warn', { array: false, object: true }],
      'prefer-template': 'warn',
      'require-await': 'warn',
      'yoda': 'error',

      // Layout & Formatting
      'comma-dangle': ['warn', 'never'],
      'indent': 'off', // Disabled - codebase uses mixed indentation
      'linebreak-style': 'off', // Allow both Windows and Unix
      'no-multiple-empty-lines': ['warn', { max: 2, maxEOF: 1 }],
      'no-trailing-spaces': 'warn',
      'quotes': ['warn', 'single', { avoidEscape: true }],
      'semi': ['error', 'always'],
      'space-before-function-paren': ['warn', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always'
      }]
    }
  },
  // Browser (frontend) files
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        // App-specific globals
        babyTracker: 'writable',
        BabyTracker: 'readonly',
        PatternAnalyzer: 'readonly'
      }
    },
    rules: {
      // Possible Problems
      'no-console': 'off', // Allow console for debugging
      'no-duplicate-imports': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-use-before-define': ['error', { functions: false, classes: true }],

      // Suggestions
      'arrow-body-style': ['warn', 'as-needed'],
      'camelcase': ['warn', { properties: 'never' }],
      'curly': ['error', 'all'],
      'default-case': 'warn',
      'dot-notation': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-else-return': 'warn',
      'no-lonely-if': 'warn',
      'no-throw-literal': 'error',
      'no-unneeded-ternary': 'warn',
      'no-var': 'error',
      'object-shorthand': ['warn', 'always'],
      'prefer-arrow-callback': 'warn',
      'prefer-const': 'warn',
      'prefer-destructuring': ['warn', { array: false, object: true }],
      'prefer-template': 'warn',
      'yoda': 'error',

      // Layout & Formatting
      'comma-dangle': ['warn', 'never'],
      'indent': 'off', // Disabled - codebase uses mixed indentation
      'linebreak-style': 'off',
      'no-multiple-empty-lines': ['warn', { max: 2, maxEOF: 1 }],
      'no-trailing-spaces': 'warn',
      'quotes': ['warn', 'single', { avoidEscape: true }],
      'semi': ['error', 'always'],
      'space-before-function-paren': ['warn', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always'
      }]
    }
  },
  // Test files
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.mocha,
        ...globals.jest
      }
    },
    rules: {
      'no-unused-vars': 'off'
    }
  }
];
