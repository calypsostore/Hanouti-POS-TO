import { beforeEach, describe, expect, it } from 'vitest';
import { authService } from '../src/services/authService';
import { seedStores, seedUsers } from '../src/services/seedData';
import { userService } from '../src/services/userService';

describe('credential lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
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

  it('requires a new password and PIN after staff password resets', async () => {
    const { staff, temporaryPassword } = await userService.createStaff({
      storeId: 'store-cafe12',
      name: 'Abdullah Ben Ali',
      positionId: 'position-barista',
    });

    const signedIn = await authService.login(staff.username ?? '', temporaryPassword);
    expect(signedIn.mustChangePassword).toBe(true);
    expect(signedIn.mustSetPin).toBe(true);

    const passwordUpdated = await authService.setInitialPassword(staff.id, 'StaffPassword1');
    expect(passwordUpdated.mustChangePassword).toBe(false);
    expect(passwordUpdated.mustSetPin).toBe(true);

    const pinUpdated = await authService.setPersonalPin(staff.id, '1234');
    expect(pinUpdated.mustSetPin).toBe(false);
    await expect(authService.setPersonalPin(staff.id, '5678')).rejects.toThrow('already set');

    await authService.changePersonalPin(staff.id, '1234', '5678');
    expect((await authService.unlockCurrentSessionWithPin('5678')).id).toBe(staff.id);

    const resetPassword = await userService.resetStaffPassword(staff.id);
    expect(await authService.getCurrentUser()).toBeNull();

    const resetLogin = await authService.login(staff.username ?? '', resetPassword);
    expect(resetLogin.mustChangePassword).toBe(true);
    expect(resetLogin.mustSetPin).toBe(true);
    const resetPasswordUpdated = await authService.setInitialPassword(staff.id, 'StaffPassword2');
    expect(resetPasswordUpdated.mustSetPin).toBe(true);
    const resetPinUpdated = await authService.setPersonalPin(staff.id, '9876');
    expect(resetPinUpdated.mustSetPin).toBe(false);
  });

  it('lets only the super admin issue owner password resets without requiring a staff PIN', async () => {
    await expect(userService.resetOwnerPassword('owner-lamarsa', 'owner-lamarsa')).rejects.toThrow('Only an active platform owner');
    await authService.login('owner@cafelamarsa.tn', 'owner123', ['owner']);
    const temporaryPassword = await userService.resetOwnerPassword('owner-lamarsa', 'super-admin');
    expect(await authService.getCurrentUser()).toBeNull();
    const owner = await authService.login('owner@cafelamarsa.tn', temporaryPassword, ['owner']);

    expect(owner.mustChangePassword).toBe(true);
    expect(owner.mustSetPin).toBe(false);
    const updatedOwner = await authService.setInitialPassword(owner.id, 'OwnerPassword1');
    expect(updatedOwner.mustChangePassword).toBe(false);
    expect(updatedOwner.mustSetPin).toBe(false);
  });
});
