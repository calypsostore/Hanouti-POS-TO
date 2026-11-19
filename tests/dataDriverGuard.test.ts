import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const servicesDirectory = fileURLToPath(new URL('../src/services/', import.meta.url));

describe('local data driver boundary', () => {
  it('requires storage-using services to declare Supabase routing and blocks local storage in Supabase mode', () => {
    const serviceFiles = readdirSync(servicesDirectory).filter((file) =>
      file.endsWith('.ts') && file !== 'storage.ts' && file !== 'mockDataService.ts');
    const storageImportPattern = /import\s*{([^}]+)}\s*from\s*['"]\.\/storage['"]/g;

    for (const file of serviceFiles) {
      const source = readFileSync(new URL(`../src/services/${file}`, import.meta.url), 'utf8');
      const imports = [...source.matchAll(storageImportPattern)];
      const usesLocalDataStorage = imports.some((match) => /\b(readData|writeData|removeData)\b/.test(match[1]));
      if (!usesLocalDataStorage) continue;

      expect(source, `${file} must import the Supabase driver guard`).toMatch(
        /import\s*{[^}]*\bisSupabaseDriver\b[^}]*}\s*from\s*['"]\.\.\/data\/driver['"]/,
      );
      expect(source, `${file} must route via isSupabaseDriver()`).toMatch(/\bisSupabaseDriver\s*\(\s*\)/);
    }

    const storage = readFileSync(new URL('../src/services/storage.ts', import.meta.url), 'utf8');
    expect(storage).toMatch(/readData[\s\S]*?assertLocalDataDriver\('read'\)/);
    expect(storage).toMatch(/writeData[\s\S]*?assertLocalDataDriver\('write'\)/);
  });
});
