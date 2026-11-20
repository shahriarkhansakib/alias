import tseslint from 'typescript-eslint';

const crossModuleInternalPatterns = [
  {
    regex:
      '^(?:\\.\\./){2,}(?:authn|authz|platform-admin)/(?:domain|application|infrastructure|http)(?:/|$)',
    message: 'Cross-module imports must go through the target module index.ts barrel.',
  },
];

const authnForbiddenCrossModulePatterns = [
  {
    regex: '(?:^|/)(?:authz|platform-admin)(?:/|$)',
    message: 'modules/authn must never import modules/authz or modules/platform-admin.',
  },
];

const domainForbiddenPatterns = [
  {
    regex: '^(?:hono|@hono|@scalar|drizzle-orm|pg|better-auth|@better-auth|nodemailer|pino)(?:/|$)',
    message:
      'Domain layer must remain pure and cannot import HTTP, ORM, DB drivers, auth SDKs, or transport.',
  },
  {
    regex: '^(?:\\.\\./)+(?:application|infrastructure|http)(?:/|$)',
    message: 'Domain layer cannot import application, infrastructure, or http layers.',
  },
  {
    regex: '(?:^|/)shared/(?:http|email)(?:/|$)',
    message: 'Domain layer cannot import shared HTTP or email adapters.',
  },
  {
    regex: '(?:^|/)db(?:/|$)',
    message: 'Domain layer cannot import database infrastructure.',
  },
  ...crossModuleInternalPatterns,
];

const applicationForbiddenPatterns = [
  {
    regex: '^(?:hono|@hono|@scalar|drizzle-orm|pg|better-auth|@better-auth|nodemailer|pino)(?:/|$)',
    message: 'Application layer cannot import HTTP, ORM, DB drivers, auth SDKs, or transport.',
  },
  {
    regex: '^(?:\\.\\./)+(?:infrastructure|http)(?:/|$)',
    message: 'Application layer cannot import infrastructure or http layers.',
  },
  {
    regex: '(?:^|/)shared/(?:http|email)(?:/|$)',
    message: 'Application layer cannot import shared HTTP or email adapters.',
  },
  {
    regex: '(?:^|/)db(?:/|$)',
    message: 'Application layer cannot import database infrastructure.',
  },
  ...crossModuleInternalPatterns,
];

const schemaForbiddenPatterns = [
  {
    regex: '^(?:\\.\\./){2,}(?:authn|authz|platform-admin)/(?:domain|application|http)(?:/|$)',
    message:
      'Drizzle schema files may only import another module infrastructure/schema.ts for SQL FK DDL.',
  },
  {
    regex:
      '^(?:\\.\\./){2,}(?:authn|authz|platform-admin)/infrastructure/(?!schema(?:\\.js|\\.ts)?$)',
    message: 'Drizzle schema files may only import schema.ts from another module infrastructure.',
  },
];

/**
 * Lean ESLint architectural boundary configuration.
 * Contains ONLY no-restricted-imports rules; all general linting/formatting is handled by Biome.
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/api/drizzle/**',
      'systems/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@alias/api',
              message: 'apps/web cannot import backend packages.',
            },
            {
              name: 'drizzle-orm',
              message: 'apps/web cannot import drizzle-orm.',
            },
            {
              name: 'pg',
              message: 'apps/web cannot import pg.',
            },
            {
              name: 'better-auth',
              message:
                'apps/web cannot import server better-auth; use better-auth/react or better-auth/client/plugins.',
            },
            {
              name: 'hono',
              message: 'apps/web cannot import hono.',
            },
            {
              name: 'nodemailer',
              message: 'apps/web cannot import nodemailer.',
            },
            {
              name: 'pino',
              message: 'apps/web cannot import pino.',
            },
          ],
          patterns: [
            {
              regex:
                '^(?:@alias/api/|drizzle-orm/|pg/|hono/|@hono/|@better-auth/|@scalar/|nodemailer/|pino/)',
              message: 'apps/web cannot import backend packages or server libraries.',
            },
            {
              regex: '^better-auth/(?!react$|client/plugins$)',
              message: 'apps/web may only import better-auth/react or better-auth/client/plugins.',
            },
            {
              regex: 'apps/api',
              message: 'apps/web cannot import files from apps/api.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/contracts/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!zod(?:/|$)|\\.{1,2}/).+',
              message:
                'packages/contracts is pure Zod-only and cannot import frameworks, ORMs, or external libraries.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/modules/*/domain/**/*.ts'],
    ignores: ['apps/api/src/modules/authn/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: domainForbiddenPatterns }],
    },
  },
  {
    files: ['apps/api/src/modules/*/application/**/*.ts'],
    ignores: ['apps/api/src/modules/authn/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: applicationForbiddenPatterns }],
    },
  },
  {
    files: ['apps/api/src/modules/*/{http,infrastructure}/**/*.ts'],
    ignores: ['apps/api/src/modules/*/infrastructure/schema.ts', 'apps/api/src/modules/authn/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: crossModuleInternalPatterns }],
    },
  },
  {
    files: ['apps/api/src/modules/*/infrastructure/schema.ts'],
    ignores: ['apps/api/src/modules/authn/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: schemaForbiddenPatterns }],
    },
  },
  {
    files: ['apps/api/src/modules/authn/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...domainForbiddenPatterns, ...authnForbiddenCrossModulePatterns] },
      ],
    },
  },
  {
    files: ['apps/api/src/modules/authn/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...applicationForbiddenPatterns, ...authnForbiddenCrossModulePatterns] },
      ],
    },
  },
  {
    files: ['apps/api/src/modules/authn/{http,infrastructure}/**/*.ts'],
    ignores: ['apps/api/src/modules/authn/infrastructure/schema.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...crossModuleInternalPatterns, ...authnForbiddenCrossModulePatterns] },
      ],
    },
  },
  {
    files: ['apps/api/src/modules/authn/infrastructure/schema.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...schemaForbiddenPatterns, ...authnForbiddenCrossModulePatterns] },
      ],
    },
  },
  {
    files: ['apps/api/src/modules/authn/index.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: authnForbiddenCrossModulePatterns }],
    },
  },
];
