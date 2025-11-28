import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    ignores: ['vitest.config.ts', 'tests/**/*.ts', 'src/test.ts', 'src/scripts/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      ...tsPlugin.configs['recommended-requiring-type-checking'].rules,

      // Enforce best practices
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Code complexity
      complexity: ['warn', 30],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 150, skipBlankLines: true, skipComments: true },
      ],

      // Naming conventions
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'class', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'] },
        { selector: 'typeAlias', format: ['PascalCase'] },
        { selector: 'enum', format: ['PascalCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        { selector: 'function', format: ['camelCase'] },
      ],

      // Prefer modern patterns
      'prefer-const': 'error',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',

      // Async best practices
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-async-promise-executor': 'error',

      // Type safety
      '@typescript-eslint/no-explicit-any': 'warn', // Warn for now, will become error
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
    },
  },
  {
    files: ['tests/**/*.ts', 'src/test.ts', 'src/scripts/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off', // Allow 'any' in test mocks and scripts
      'no-console': 'off', // Allow console in test and script files
    },
  },
  {
    files: ['vitest.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // More lenient rules for MCP server index and large tools
  {
    files: [
      'src/index.ts',
      'src/templates.ts',
      'src/models/Search.ts',
      'src/utils/logger.ts',
      'src/services/embeddings/EmbeddingCache.ts',
      'src/services/embeddings/EmbeddingService.ts',
      'src/services/search/IndexedSearch.ts',
      'src/services/search/KeywordSearch.ts',
      'src/services/search/SemanticSearch.ts',
      'src/tools/search/searchVault.ts',
      'src/tools/session/closeSession.ts',
      'src/tools/maintenance/vaultCustodian.ts',
      'src/tools/maintenance/toggleEmbeddings.ts',
      'src/tools/memory/generateVaultIndex.ts',
      'src/tools/git/analyzeCommitImpact.ts',
      'src/tools/git/migrateProjectSlugs.ts',
      'src/tools/topics/analyzeTopicContent.ts',
    ],
    rules: {
      complexity: ['warn', 70],
      'max-lines': ['warn', { max: 2500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      'no-console': 'off',
    },
  },
  prettierConfig,
];
