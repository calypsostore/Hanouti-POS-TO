import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const callbacks: Array<() => void> = [];
  const channel = {
    on: vi.fn((_event: unknown, _filter: unknown, callback: () => void) => {
      callbacks.push(callback);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return {
    callbacks,
    channel,
    client: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(() => Promise.resolve()),
    },
  };
});

vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => true }));
vi.mock('../src/data/supabaseClient', () => ({ getSupabaseClient: () => mocks.client }));

import { subscribeToStoreChanges } from '../src/data/repositories/realtimeRepository';

describe('store realtime refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.callbacks.length = 0;
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces repeated table changes into one refresh', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToStoreChanges('store-1', ['orders'], onChange);

    mocks.callbacks[0]();
    mocks.callbacks[0]();
    vi.advanceTimersByTime(249);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
