import { describe, expect, it, vi } from 'vitest';
import { retryRead } from '../src/lib/retryRead';

describe('retryRead', () => {
  it('retries eligible reads with bounded attempts', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('Failed to fetch');
      return 'ok';
    });

    const promise = retryRead(operation, { attempts: 3, baseDelayMs: 10 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry a permanent read error', async () => {
    const error = new Error('Permission denied');
    const operation = vi.fn(async () => {
      throw error;
    });

    await expect(retryRead(operation, { attempts: 3 })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('times out a stalled read', async () => {
    vi.useFakeTimers();
    const promise = retryRead(() => new Promise<string>(() => undefined), {
      attempts: 1,
      timeoutMs: 20,
    });
    const rejection = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    vi.useRealTimers();
  });
});
