import { describe, expect, it } from 'vitest';
import { PERMISSIONS, resolveEffectivePermissionIds } from '../src/services/users/userValidation';

describe('effective store permissions', () => {
  it('exposes separate fiscal configuration and report permissions for staff positions', () => {
    expect(PERMISSIONS.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'manage_fiscal',
      'view_fiscal_reports',
    ]));
  });

  it('expands store-operations access into all assignable operational permissions', () => {
    const effective = resolveEffectivePermissionIds(['manage_store_operations']);

    expect(effective).toContain('manage_catalog');
    expect(effective).toContain('manage_shifts');
    expect(effective).toContain('manage_fiscal');
    expect(effective).toContain('view_activity_log');
  });

  it('keeps individual overrides effective when a broad position is assigned', () => {
    const effective = resolveEffectivePermissionIds(
      ['manage_store_operations'],
      [],
      ['manage_fiscal', 'manage_catalog'],
    );

    expect(effective).not.toContain('manage_fiscal');
    expect(effective).not.toContain('manage_catalog');
    expect(effective).toContain('manage_shifts');
  });

  it('removes permissions inherited only from a revoked parent permission', () => {
    const effective = resolveEffectivePermissionIds(
      ['manage_store_operations', 'manage_shifts'],
      [],
      ['manage_store_operations', 'manage_shifts'],
    );

    expect(effective).not.toContain('manage_fiscal');
    expect(effective).not.toContain('open_close_shift');
    expect(effective).not.toContain('resolve_voids');
  });

  it('matches delegated report and shift permission implications', () => {
    expect(resolveEffectivePermissionIds(['manage_shifts'])).toEqual(expect.arrayContaining([
      'open_close_shift',
      'resolve_voids',
      'view_dashboard',
      'view_reports',
      'view_all_orders',
    ]));
    expect(resolveEffectivePermissionIds(['view_reports'])).toContain('view_all_orders');
    expect(resolveEffectivePermissionIds(['view_dashboard'])).toContain('view_all_orders');
  });

  it('expands module permissions only to their required actions', () => {
    const effective = resolveEffectivePermissionIds(['manage_schedule']);

    expect(effective).toContain('view_schedule');
    expect(effective).not.toContain('manage_shifts');
    expect(effective).not.toContain('view_reports');
  });
});
