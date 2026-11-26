import { beforeEach, describe, expect, it } from 'vitest';
import { authService } from '../src/services/authService';
import { getCredentialSetupStep, isValidPinConfirmation, requiresCredentialSetup } from '../src/services/credentialSetup';
import { seedStores, seedUsers } from '../src/services/seedData';
import { generateStaffPin, isAcceptableStaffPin } from '../src/services/staffPin';
import { userService } from '../src/services/userService';
import { useAuthStore } from '../src/stores/authStore';
import type { UserRecord } from '../src/types/domain';

describe('credential lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('orders Owner setup stages and requires matching four-digit PIN confirmations', () => {
    expect(getCredentialSetupStep({
      role: 'owner',
      mustChangePassword: true,
      mustSetPin: true,
      mustSetVoidPin: true,
    })).toBe('password');
    expect(getCredentialSetupStep({
      role: 'owner',
      mustChangePassword: false,
      mustSetPin: true,
      mustSetVoidPin: true,
    })).toBe('personal-pin');
    expect(getCredentialSetupStep({
      role: 'owner',
      mustChangePassword: false,
      mustSetPin: false,
      mustSetVoidPin: true,
    })).toBe('store-pin');
    expect(getCredentialSetupStep({
      role: 'owner',
      mustChangePassword: false,
      mustSetPin: false,
      mustSetVoidPin: false,
    })).toBe('complete');
    expect(getCredentialSetupStep({
      role: 'staff',
      mustChangePassword: false,
      mustSetPin: true,
      mustSetVoidPin: true,
    })).toBe('complete');

    expect(isValidPinConfirmation('2468', '2468')).toBe(true);
    expect(isValidPinConfirmation('2468', '2469')).toBe(false);
    expect(isValidPinConfirmation('246', '246')).toBe(false);
  });

  it('generates store IDs from names and increments duplicate IDs', async () => {
    expect(userService.generateStoreCode('Orange')).toBe('orng');
    expect(userService.generateStoreCode('Oranges Bites')).toBe('orbt');
    expect(userService.generateStoreCode('Orange', ['ORNG'])).toBe('orng1');

    const first = await userService.createOwnerAccount({
      name: 'Owner One',
      email: 'owner-one@example.com',
      storeName: 'Oranges Bites',
    });
    const duplicate = await userService.createOwnerAccount({
      name: 'Owner Two',
      email: 'owner-two@example.com',
      storeName: 'Oranges Bites',
    });

    expect(first.store.code).toBe('orbt');
    expect(duplicate.store.code).toBe('orbt1');
  });

  it('requires new owners to set a password and personal PIN, and lets them update their profile', async () => {
    const { owner, temporaryPassword, store } = await userService.createOwnerAccount({
      name: 'New Owner',
      email: 'new-owner@example.com',
      storeName: 'New Store',
    });

    const signedIn = await authService.login(owner.email ?? '', temporaryPassword, ['owner']);
    expect(signedIn.mustChangePassword).toBe(true);
    expect(signedIn.mustSetPin).toBe(true);
    expect(signedIn.mustSetVoidPin).toBe(true);

    const passwordUpdated = await authService.setInitialPassword(owner.id, 'OwnerPassword1');
    expect(passwordUpdated.mustChangePassword).toBe(false);
    expect(passwordUpdated.mustSetPin).toBe(true);
    expect(getCredentialSetupStep(passwordUpdated)).toBe('personal-pin');
    const pinUpdated = await authService.setPersonalPin(owner.id, '1234');
    expect(pinUpdated.mustSetPin).toBe(false);
    expect(pinUpdated.mustSetVoidPin).toBe(true);
    expect(getCredentialSetupStep(pinUpdated)).toBe('store-pin');
    await userService.updateStorePin(store.id, '2468');
    await useAuthStore.getState().refreshCurrentUser();
    const refreshedUser = await authService.getCurrentUser();
    expect(refreshedUser?.mustSetVoidPin).toBe(false);
    expect(getCredentialSetupStep(refreshedUser)).toBe('complete');

    await authService.changePersonalPin(owner.id, '1234', '5678');
    await expect(authService.verifyFiscalProfileOwnerCredential(store.id, 'pin', '5678')).resolves.toBeUndefined();
    await expect(authService.verifyFiscalProfileOwnerCredential(store.id, 'pin', '0000')).rejects.toThrow('Incorrect PIN.');
    await expect(authService.verifyFiscalProfileOwnerCredential(store.id, 'password', 'OwnerPassword1')).resolves.toBeUndefined();
    await expect(authService.verifyFiscalProfileOwnerCredential(store.id, 'password', 'wrong-password')).rejects.toThrow('Password is incorrect.');
    await authService.lockCurrentSession();
    expect(await authService.isSessionLocked(owner.id)).toBe(true);
    expect((await authService.unlockCurrentSessionWithPin('5678')).id).toBe(owner.id);
    await authService.lockCurrentSession();
    expect((await authService.unlockCurrentSessionWithPassword('OwnerPassword1')).id).toBe(owner.id);
    await userService.updateOwnerProfile(owner.id, { name: 'Updated Owner', phone: '55512345' });
    const updatedOwner = await userService.getUser(owner.id);
    expect(updatedOwner?.name).toBe('Updated Owner');
    expect(updatedOwner?.phone).toBe('55512345');
    expect(updatedOwner?.email).toBe('new-owner@example.com');

    await expect(userService.updateStoreInfo(store.id, owner.id, { name: 'Updated Store' })).resolves.toMatchObject({
      id: store.id,
      name: 'Updated Store',
    });
    await authService.logout();
    expect(await authService.getCurrentUser()).toBeNull();
  });

  it('skips Store PIN setup on subsequent Owner login after pin_must_change is cleared', async () => {
    const { owner, temporaryPassword, store } = await userService.createOwnerAccount({
      name: 'Store PIN Owner',
      email: 'store-pin-owner@example.com',
      storeName: 'Store PIN Store',
    });

    await authService.login(owner.email ?? '', temporaryPassword, ['owner']);
    await authService.setInitialPassword(owner.id, 'OwnerPassword1');
    await authService.setPersonalPin(owner.id, '1234');
    await userService.updateStorePin(store.id, '2468');
    await authService.logout();

    const subsequentLogin = await authService.login(owner.email ?? '', 'OwnerPassword1', ['owner']);

    expect(subsequentLogin.mustSetVoidPin).toBe(false);
    expect(getCredentialSetupStep(subsequentLogin)).toBe('complete');
  });

  it('preserves void, credit_override, and z_report Store PIN verification purposes', async () => {
    const { owner, temporaryPassword, store } = await userService.createOwnerAccount({
      name: 'Purpose Owner',
      email: 'purpose-owner@example.com',
      storeName: 'Purpose Store',
    });

    await authService.login(owner.email ?? '', temporaryPassword, ['owner']);
    await authService.setInitialPassword(owner.id, 'OwnerPassword1');
    await authService.setPersonalPin(owner.id, '1234');
    await userService.updateStorePin(store.id, '2468');

    await expect(userService.verifyStorePin(store.id, '2468', 'void')).resolves.toBe(true);
    await expect(userService.verifyStorePin(store.id, '2468', 'credit_override')).resolves.toBe(true);
    await expect(userService.verifyStorePin(store.id, '2468', 'z_report')).resolves.toBe(true);
  });

  it('lets the owner configure separate staff and owner auto-lock timeouts, including never', async () => {
    const { owner, store } = await userService.createOwnerAccount({
      name: 'Timeout Owner',
      email: 'timeout-owner@example.com',
      storeName: 'Timeout Store',
    });

    await expect(userService.updateStoreAutoLockMinutes(store.id, owner.id, 'staff', 0)).resolves.toMatchObject({
      staffAutoLockMinutes: 0,
    });
    await expect(userService.updateStoreAutoLockMinutes(store.id, owner.id, 'owner', 0)).resolves.toMatchObject({
      ownerAutoLockMinutes: 0,
      staffAutoLockMinutes: 0,
    });
    await expect(userService.updateStoreAutoLockMinutes(store.id, owner.id, 'owner', 61)).rejects.toThrow('between 0 and 60');
  });

  it('migrates the local demo store and its staff usernames', async () => {
    localStorage.setItem('7anouti-pos:stores', JSON.stringify(seedStores.map((store) => ({ ...store, code: 'cafe12' }))));
    localStorage.setItem('7anouti-pos:users', JSON.stringify(seedUsers.map((member) => (
      member.role === 'staff'
        ? { ...member, username: `cafe12.${member.name.toLocaleLowerCase()}` }
        : member
    ))));

    const [store] = await userService.listStores();

    expect(store.code).toBe('cfsd');
    expect((await userService.getUser('staff-sarah'))?.username).toBe('CFSD.sarah');
    expect((await userService.getUser('staff-abdullah'))?.username).toBe('CFSD.abdullah');
  });

  it('creates store-first usernames and increments duplicate first names', async () => {
    const first = await userService.createStaff({
      storeId: 'store-cafe12',
      name: 'Sarah Smith',
      positionId: 'position-barista',
    });
    const duplicate = await userService.createStaff({
      storeId: 'store-cafe12',
      name: 'Sarah Smith',
      positionId: 'position-barista',
    });

    expect(first.staff.username).toBe('CFSD.sarah1');
    expect(duplicate.staff.username).toBe('CFSD.sarah2');
    expect(duplicate.staff.mustChangePassword).toBe(true);
    expect(duplicate.staff.mustSetPin).toBe(true);
    expect(duplicate.temporaryPassword).toHaveLength(6);
  });

  it('requires Staff to change only their password and lets the Owner generate and replace unique PINs', async () => {
    const { owner, temporaryPassword: ownerTemporaryPassword, store } = await userService.createOwnerAccount({
      name: 'PIN Owner',
      email: 'pin-owner@example.com',
      storeName: 'PIN Store',
    });
    await authService.login(owner.email ?? '', ownerTemporaryPassword, ['owner']);
    await authService.setInitialPassword(owner.id, 'OwnerPassword1');
    await authService.setPersonalPin(owner.id, '1357');
    await userService.updateStorePin(store.id, '8642');
    const position = await userService.createPosition(store.id, 'Counter staff', []);

    const first = await userService.createStaff({
      storeId: store.id,
      name: 'First Staff',
      positionId: position.id,
    });
    const second = await userService.createStaff({
      storeId: store.id,
      name: 'Second Staff',
      positionId: position.id,
    });

    const firstLogin = await authService.login(first.staff.username ?? '', first.temporaryPassword, ['staff']);
    expect(firstLogin.mustChangePassword).toBe(true);
    expect(firstLogin.mustSetPin).toBe(true);
    expect(requiresCredentialSetup(firstLogin)).toBe(true);

    const passwordUpdated = await authService.setInitialPassword(first.staff.id, 'StaffPassword1');
    expect(passwordUpdated.mustSetPin).toBe(true);
    expect(requiresCredentialSetup(passwordUpdated)).toBe(false);
    await expect(authService.setPersonalPin(first.staff.id, '1234')).rejects.toThrow('Only a signed-in store owner');
    await expect(authService.changePersonalPin(first.staff.id, '1234', '5678')).rejects.toThrow('Only a signed-in store owner');

    await authService.login(owner.email ?? '', 'OwnerPassword1', ['owner']);
    const firstPin = await userService.generateStaffPin(owner.id, first.staff.id);
    const firstPinStatus = await userService.getUser(first.staff.id);
    expect(firstPin).toMatch(/^\d{4}$/);
    expect(isAcceptableStaffPin(firstPin)).toBe(true);
    expect(firstPinStatus?.mustSetPin).toBe(false);
    const storedUsers = JSON.parse(localStorage.getItem('7anouti-pos:users') ?? '[]') as UserRecord[];
    const storedFirstStaff = storedUsers.find((candidate) => candidate.id === first.staff.id);
    expect(storedFirstStaff?.pinHash).toMatch(/^pbkdf2-sha256\$/);
    expect(storedFirstStaff?.pinHash).not.toBe(firstPin);

    const secondPin = await userService.generateStaffPin(owner.id, second.staff.id);
    expect(secondPin).not.toBe(firstPin);
    expect(isAcceptableStaffPin(secondPin)).toBe(true);

    const secondLogin = await authService.login(second.staff.username ?? '', second.temporaryPassword, ['staff']);
    expect(secondLogin.mustChangePassword).toBe(true);
    expect(secondLogin.mustSetPin).toBe(false);
    const secondPasswordUpdated = await authService.setInitialPassword(second.staff.id, 'StaffPassword2');
    expect(requiresCredentialSetup(secondPasswordUpdated)).toBe(false);
    expect((await userService.getUser(second.staff.id))?.mustSetPin).toBe(false);
    await authService.lockCurrentSession();
    expect((await authService.unlockCurrentSessionWithPin(secondPin)).id).toBe(second.staff.id);

    await authService.login(owner.email ?? '', 'OwnerPassword1', ['owner']);
    await authService.login(first.staff.username ?? '', 'StaffPassword1', ['staff']);
    await expect(userService.generateStaffPin(first.staff.id, second.staff.id)).rejects.toThrow('Only this store owner');
    await authService.lockCurrentSession();
    expect((await authService.unlockCurrentSessionWithPin(firstPin)).id).toBe(first.staff.id);

    await authService.login(owner.email ?? '', 'OwnerPassword1', ['owner']);
    const replacementPin = await userService.generateStaffPin(owner.id, first.staff.id);
    expect(replacementPin).not.toBe(firstPin);

    await authService.login(first.staff.username ?? '', 'StaffPassword1', ['staff']);
    await authService.lockCurrentSession();
    await expect(authService.unlockCurrentSessionWithPin(firstPin)).rejects.toThrow('Incorrect PIN.');
    expect((await authService.unlockCurrentSessionWithPin(replacementPin)).id).toBe(first.staff.id);

    await authService.login(owner.email ?? '', 'OwnerPassword1', ['owner']);
    await expect(authService.verifyFiscalProfileOwnerCredential(store.id, 'pin', '1357')).resolves.toBeUndefined();
    await expect(userService.verifyStorePin(store.id, '8642', 'void')).resolves.toBe(true);
  }, 20_000);

  it('rejects predictable Staff PIN patterns and retries collisions', async () => {
    for (const pin of ['1234', '4321', '1111', '1122', '1212', '1221', '1357', '2580']) {
      expect(isAcceptableStaffPin(pin)).toBe(false);
    }
    expect(isAcceptableStaffPin('4826')).toBe(true);

    let uniquenessChecks = 0;
    const pin = await generateStaffPin(async () => {
      uniquenessChecks += 1;
      return uniquenessChecks === 3;
    });
    expect(uniquenessChecks).toBe(3);
    expect(isAcceptableStaffPin(pin)).toBe(true);
  });

  it('lets only the super admin issue owner password resets without requiring a staff PIN', async () => {
    await expect(userService.resetOwnerPassword('owner-lamarsa', 'owner-lamarsa')).rejects.toThrow('Only an active platform owner');
    const seedOwner = await authService.login('owner@cafelamarsa.tn', 'owner123', ['owner']);
    expect(seedOwner.mustSetPin).toBe(true);
    const temporaryPassword = await userService.resetOwnerPassword('owner-lamarsa', 'super-admin');
    expect(await authService.getCurrentUser()).toBeNull();
    const owner = await authService.login('owner@cafelamarsa.tn', temporaryPassword, ['owner']);

    expect(owner.mustChangePassword).toBe(true);
    expect(owner.mustSetPin).toBe(true);
    const updatedOwner = await authService.setInitialPassword(owner.id, 'OwnerPassword1');
    expect(updatedOwner.mustChangePassword).toBe(false);
    expect(updatedOwner.mustSetPin).toBe(true);
    await expect(authService.setPersonalPin(owner.id, '1234')).resolves.toMatchObject({ mustSetPin: false });
  });
});
