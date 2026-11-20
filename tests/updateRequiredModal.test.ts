import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UpdateRequiredModal } from '../src/components/UpdateRequiredModal';
import {
  confirmUpdateIfUnsaved,
  shouldSnoozeUpdate,
  UPDATE_REMINDER_DELAY_MS,
} from '../src/services/updateModalLogic';
import type { UpdateCheckResult } from '../src/services/updateService';

vi.mock('../src/services/updateService', () => ({
  updateService: {
    hasUnsavedChanges: vi.fn().mockReturnValue(false),
    applyUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));

const availableUpdate: UpdateCheckResult = {
  mode: 'hosted',
  currentVersion: '1.0.3',
  currentBuild: 'old-build',
  latestVersion: '1.0.4',
  latestBuild: 'new-build',
  latestApkUrl: null,
  checkedAt: '2025-01-01T00:00:00.000Z',
  updateAvailable: true,
};

describe('required update modal logic', () => {
  it('shows the blocking modal when an update is found', () => {
    const markup = renderToStaticMarkup(React.createElement(UpdateRequiredModal, { result: availableUpdate }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('Update required');
    expect(markup).toContain('A new version is available. Please update to continue.');
    expect(markup).toContain('Current: v1.0.3 (build old-build)');
    expect(markup).toContain('New: v1.0.4 (build new-build)');
    expect(markup).toContain('Update now');
    expect(markup).toContain('Remind me after 5 minutes');
  });

  it('snoozes only the matching update build until the reminder deadline', () => {
    const reminder = { build: 'new-build', remindAt: 300_000 };

    expect(UPDATE_REMINDER_DELAY_MS).toBe(300_000);
    expect(shouldSnoozeUpdate(reminder, 'new-build', 299_999)).toBe(true);
    expect(shouldSnoozeUpdate(reminder, 'new-build', 300_000)).toBe(false);
    expect(shouldSnoozeUpdate(reminder, 'another-build', 299_999)).toBe(false);
  });

  it('does not show the modal when the build matches', () => {
    const result = { ...availableUpdate, latestBuild: 'old-build', updateAvailable: false };

    expect(renderToStaticMarkup(React.createElement(UpdateRequiredModal, { result }))).toBe('');
  });

  it('asks for confirmation before reloading with unsaved work', () => {
    const confirm = vi.fn().mockReturnValue(false);

    expect(confirmUpdateIfUnsaved(true, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain('unsaved work');
  });
});
