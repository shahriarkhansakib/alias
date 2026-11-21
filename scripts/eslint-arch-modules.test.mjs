// Checks that MODULES in packages/config/eslint-arch.mjs lists exactly the folders in
// apps/api/src/modules/, so every module is covered by the architecture boundary rules.
// Uses Vitest globals (see scripts/vitest.config.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES } from '../packages/config/eslint-arch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES_DIR = path.join(ROOT, 'apps/api/src/modules');

/** Names of the folders (not files) directly inside `dir`. */
function listModuleFolders(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** Folders missing from MODULES, MODULES entries without a folder, and duplicated entries. */
function compareModules(modules, folders) {
  return {
    missing: folders.filter((name) => !modules.includes(name)).sort(),
    extra: [...new Set(modules.filter((name) => !folders.includes(name)))].sort(),
    duplicates: [...new Set(modules.filter((name, i) => modules.indexOf(name) !== i))].sort(),
  };
}

/** A readable explanation of a mismatch, or '' when MODULES matches the folders. */
function describeMismatch({ missing, extra, duplicates }) {
  const lines = [];
  if (missing.length) {
    lines.push(`missing from MODULES (folder exists, add it): ${missing.join(', ')}`);
  }
  if (extra.length) {
    lines.push(`extra in MODULES (no such folder, remove it): ${extra.join(', ')}`);
  }
  if (duplicates.length) lines.push(`listed more than once in MODULES: ${duplicates.join(', ')}`);
  if (lines.length === 0) return '';
  return [
    'MODULES in packages/config/eslint-arch.mjs does not match apps/api/src/modules/:',
    ...lines.map((line) => `  - ${line}`),
  ].join('\n');
}

let tmp;

function makeModulesDir(folders, files = []) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modules-'));
  for (const name of folders) fs.mkdirSync(path.join(tmp, name));
  for (const name of files) fs.writeFileSync(path.join(tmp, name), '');
  return tmp;
}

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('eslint-arch MODULES', () => {
  describe('happy paths', () => {
    it('lists exactly the folders in apps/api/src/modules/', () => {
      const message = describeMismatch(compareModules(MODULES, listModuleFolders(MODULES_DIR)));
      expect(message, message).toBe('');
    });

    it('matches when the same names are in a different order', () => {
      expect(describeMismatch(compareModules(['b', 'a'], ['a', 'b']))).toBe('');
    });
  });

  describe('edge cases', () => {
    it('ignores files next to the module folders', () => {
      const dir = makeModulesDir(['authn', 'authz'], ['README.md', '.DS_Store']);
      expect(listModuleFolders(dir).sort()).toEqual(['authn', 'authz']);
    });

    it('treats an empty modules folder with an empty MODULES list as a match', () => {
      expect(describeMismatch(compareModules([], listModuleFolders(makeModulesDir([]))))).toBe('');
    });

    it('reports a module listed twice', () => {
      expect(describeMismatch(compareModules(['authn', 'authn'], ['authn']))).toContain(
        'listed more than once in MODULES: authn',
      );
    });
  });

  describe('error cases', () => {
    it('names a module folder that is missing from MODULES', () => {
      const message = describeMismatch(compareModules(['authn'], ['authn', 'intake']));
      expect(message).toContain('packages/config/eslint-arch.mjs');
      expect(message).toContain('missing from MODULES (folder exists, add it): intake');
      expect(message).not.toContain('extra in MODULES');
    });

    it('names a MODULES entry that has no folder', () => {
      const message = describeMismatch(compareModules(['authn', 'budget'], ['authn']));
      expect(message).toContain('extra in MODULES (no such folder, remove it): budget');
      expect(message).not.toContain('missing from MODULES');
    });

    it('names missing and extra modules together', () => {
      const message = describeMismatch(
        compareModules(['authn', 'old-name'], ['authn', 'new-name', 'intake']),
      );
      expect(message).toBe(
        [
          'MODULES in packages/config/eslint-arch.mjs does not match apps/api/src/modules/:',
          '  - missing from MODULES (folder exists, add it): intake, new-name',
          '  - extra in MODULES (no such folder, remove it): old-name',
        ].join('\n'),
      );
    });
  });
});
