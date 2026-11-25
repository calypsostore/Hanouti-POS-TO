import { beforeEach, describe, expect, it } from 'vitest';
import { activityService } from '../src/services/activityService';

describe('activity service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('formats new and stored activity amounts in DT', async () => {
    localStorage.setItem('7anouti-pos:activity-logs', JSON.stringify([{
      id: 'legacy-entry',
      storeId: 'store-1',
      actorId: 'staff-1',
      actorName: 'Staff',
      actorRole: 'staff',
      action: 'shift.closed',
      summary: 'Closed shift with a cash difference of -1223 millimes.',
      entityType: 'shift',
      entityId: 'shift-1',
      meta: {},
      createdAt: '2026-11-25T10:00:00.000Z',
    }]));

    const created = await activityService.log({
      storeId: 'store-1',
      action: 'cash.in',
      summary: 'Recorded cash in of 2500 millimes.',
      entityType: 'cash_movement',
      entityId: 'movement-1',
    });

    expect(created.summary).toBe('Recorded cash in of 2.500 DT.');
    await expect(activityService.list('store-1')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'legacy-entry', summary: 'Closed shift with a cash difference of -1.223 DT.' }),
        expect.objectContaining({ id: created.id, summary: 'Recorded cash in of 2.500 DT.' }),
      ]),
    );
  });
});
