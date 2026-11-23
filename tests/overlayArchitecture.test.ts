import { describe, expect, it } from 'vitest';
import { getOverlayZIndex } from '../src/components/overlay/overlayArchitecture';

describe('overlay architecture', () => {
  it('uses centralized semantic z-index layers', () => {
    expect(getOverlayZIndex('critical')).toBeGreaterThan(getOverlayZIndex('prompt'));
    expect(getOverlayZIndex('prompt')).toBeGreaterThan(getOverlayZIndex('popover'));
    expect(getOverlayZIndex('popover')).toBeGreaterThan(getOverlayZIndex('dialog'));
  });

  it('keeps nested sheet and dialog overlays at one semantic modal layer', () => {
    expect(getOverlayZIndex('sheet')).toBe(getOverlayZIndex('dialog'));
  });
});
