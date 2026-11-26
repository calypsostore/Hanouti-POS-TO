import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCredentialSetupStep } from '../src/services/credentialSetup';
import { SetNewPasswordScreen } from '../src/screens/SetNewPasswordScreen';

const hooks = vi.hoisted(() => {
  let values: unknown[] = [];
  let hookIndex = 0;

  return {
    reset() {
      values = [];
      hookIndex = 0;
    },
    beginRender() {
      hookIndex = 0;
    },
    useState<T>(initial: T): [T, (next: T | ((current: T) => T)) => void] {
      const currentIndex = hookIndex++;
      if (currentIndex >= values.length) values.push(initial);
      const setValue = (next: T | ((current: T) => T)) => {
        const current = values[currentIndex] as T;
        values[currentIndex] = typeof next === 'function'
          ? (next as (value: T) => T)(current)
          : next;
      };
      return [values[currentIndex] as T, setValue];
    },
    useEffect: vi.fn(),
  };
});

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  setInitialPassword: vi.fn(async (_password: string) => undefined),
  setInitialPin: vi.fn(async (_pin: string) => undefined),
  updateStorePin: vi.fn(async (_storeId: string, _pin: string) => undefined),
  refreshCurrentUser: vi.fn(async () => undefined),
  navigate: vi.fn(),
  onSetupComplete: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: hooks.useState, useEffect: hooks.useEffect };
});

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));

vi.mock('../src/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({
      user: mocks.user,
      setInitialPassword: mocks.setInitialPassword,
      setInitialPin: mocks.setInitialPin,
    }),
    { getState: () => ({ refreshCurrentUser: mocks.refreshCurrentUser }) },
  ),
}));

vi.mock('../src/services/userService', () => ({
  userService: {
    getStore: vi.fn(async () => undefined),
    updateStorePin: mocks.updateStorePin,
  },
}));

vi.mock('../src/i18n/translations', () => ({ t: (key: string) => key }));

type TestElement = {
  type: unknown;
  props: Record<string, unknown>;
};

function findElement(node: unknown, predicate: (element: TestElement) => boolean): TestElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object' || node === null || !('props' in node)) return undefined;

  const element = node as TestElement;
  if (predicate(element)) return element;
  return findElement(element.props.children, predicate);
}

function renderScreen(): TestElement {
  hooks.beginRender();
  return SetNewPasswordScreen({ onSetupComplete: mocks.onSetupComplete }) as unknown as TestElement;
}

function fillInput(id: string, value: string): void {
  const input = findElement(renderScreen(), (element) => element.props.id === id);
  if (!input) throw new Error(`Input ${id} was not rendered.`);
  const onChange = input.props.onChange as (event: { target: { value: string } }) => void;
  onChange({ target: { value } });
}

async function submitScreen(): Promise<void> {
  const form = findElement(renderScreen(), (element) => element.type === 'form');
  if (!form) throw new Error('Setup form was not rendered.');
  const onSubmit = form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>;
  await onSubmit({ preventDefault: vi.fn() });
}

function ownerUser(flags: { mustSetPin: boolean; mustSetVoidPin: boolean }) {
  return {
    id: 'owner-1',
    role: 'owner',
    storeId: 'store-1',
    name: 'Owner',
    username: 'owner',
    mustChangePassword: false,
    ...flags,
  };
}

describe('SetNewPasswordScreen PIN submission', () => {
  beforeEach(() => {
    hooks.reset();
    vi.clearAllMocks();
    mocks.user = null;
  });

  it('does not call the Personal PIN setter for a mismatched confirmation', async () => {
    mocks.user = ownerUser({ mustSetPin: true, mustSetVoidPin: true });

    fillInput('setup-pin', '2468');
    fillInput('confirm-setup-pin', '2469');
    await submitScreen();

    expect(mocks.setInitialPin).not.toHaveBeenCalled();
  });

  it('does not call updateStorePin for a mismatched confirmation', async () => {
    mocks.user = ownerUser({ mustSetPin: false, mustSetVoidPin: true });

    fillInput('setup-pin', '2468');
    fillInput('confirm-setup-pin', '2469');
    await submitScreen();

    expect(mocks.updateStorePin).not.toHaveBeenCalled();
    expect(mocks.refreshCurrentUser).not.toHaveBeenCalled();
  });

  it('updates the Store PIN once, refreshes the user, and completes setup after a match', async () => {
    mocks.user = ownerUser({ mustSetPin: false, mustSetVoidPin: true });
    mocks.refreshCurrentUser.mockImplementation(async () => {
      mocks.user = ownerUser({ mustSetPin: false, mustSetVoidPin: false });
    });

    fillInput('setup-pin', '2468');
    fillInput('confirm-setup-pin', '2468');
    await submitScreen();

    expect(mocks.updateStorePin).toHaveBeenCalledTimes(1);
    expect(mocks.updateStorePin).toHaveBeenCalledWith('store-1', '2468');
    expect(mocks.refreshCurrentUser).toHaveBeenCalledTimes(1);
    expect(mocks.onSetupComplete).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/owner/dashboard');
    expect(getCredentialSetupStep(mocks.user as Parameters<typeof getCredentialSetupStep>[0])).toBe('complete');
  });

  it('does not send Staff through Owner Personal PIN or Store PIN setup', () => {
    mocks.user = {
      ...ownerUser({ mustSetPin: true, mustSetVoidPin: true }),
      role: 'staff',
      mustChangePassword: false,
    };

    const screen = renderScreen();

    expect(getCredentialSetupStep(mocks.user as Parameters<typeof getCredentialSetupStep>[0])).toBe('complete');
    expect(findElement(screen, (element) => element.props.id === 'setup-pin')).toBeUndefined();
    expect(findElement(screen, (element) => element.props.id === 'new-password')).toBeDefined();
    expect(mocks.setInitialPin).not.toHaveBeenCalled();
    expect(mocks.updateStorePin).not.toHaveBeenCalled();
  });
});
