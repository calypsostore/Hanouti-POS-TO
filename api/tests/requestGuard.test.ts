import { describe, expect, it, vi } from 'vitest';
import { createLatestRequestGuard, createSubmissionGate } from '../src/lib/requestGuard';

describe('request guards', () => {
  it('rejects stale refresh responses', () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isLatest(first)).toBe(false);
    expect(guard.isLatest(second)).toBe(true);
  });

  it('allows only one concurrent submission', async () => {
    const gate = createSubmissionGate();
    let resolveOperation!: () => void;
    const operation = vi.fn(() => new Promise<void>((resolve) => {
      resolveOperation = resolve;
    }));

    const first = gate.run(operation);
    const repeated = gate.run(operation);
    expect(operation).toHaveBeenCalledTimes(1);
    resolveOperation();
    await first;
    await repeated;
  });
});
