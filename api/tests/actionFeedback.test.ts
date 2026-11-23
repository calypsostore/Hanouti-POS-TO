import { describe, expect, it } from 'vitest';
import { classifyActionFeedback } from '../src/lib/actionFeedback';

describe('classifyActionFeedback', () => {
  it('classifies existing success and error messages', () => {
    expect(classifyActionFeedback('status', 'bg-success-container text-on-success-container', 'Store information saved.')).toBe('success');
    expect(classifyActionFeedback('alert', 'bg-error-container text-on-error-container', 'Unable to save settings.')).toBe('error');
  });

  it('does not turn warnings or informational statuses into success/error toasts', () => {
    expect(classifyActionFeedback('status', 'bg-warning-container text-on-warning-container', 'Low stock.')).toBeUndefined();
    expect(classifyActionFeedback('status', 'text-outline', 'Checking customer credit…')).toBeUndefined();
  });

  it('recognizes errors and successes in existing POS action toasts', () => {
    expect(classifyActionFeedback('status', 'bg-primary-dark', 'Order restored.')).toBe('success');
    expect(classifyActionFeedback('status', 'bg-primary-dark', 'Unable to load customer credit status.')).toBe('error');
  });
});
