import { describe, expect, it } from 'vitest';
import { compareVersions } from '../src/services/versionComparison';

describe('compareVersions', () => {
  it('orders patch versions numerically', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
  });

  it('compares multi-digit minor versions numerically', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
  });

  it('orders major versions numerically', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('returns zero for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('rejects invalid versions', () => {
    expect(compareVersions('1.2', '1.2.0')).toBeNull();
    expect(compareVersions('1.02.0', '1.2.0')).toBeNull();
  });
});
