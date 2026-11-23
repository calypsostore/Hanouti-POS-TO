export type ActionFeedbackKind = 'success' | 'error';

const actionFailureText = /\b(unable|could not|failed|failure|error|limit reached|not allowed|cannot|can't)\b/i;

export function classifyActionFeedback(
  role: string | null,
  className: string,
  message: string,
): ActionFeedbackKind | undefined {
  const classes = className.split(/\s+/);
  const isWarning = classes.some((token) => token.includes('warning'));
  if (isWarning) return undefined;

  const isError = classes.some((token) => token.includes('error'));
  if (isError || role === 'alert') return 'error';

  const isSuccess = classes.some((token) => token.includes('success'));
  if (isSuccess) return 'success';

  if (role === 'status' && classes.includes('bg-primary-dark')) {
    return actionFailureText.test(message) ? 'error' : 'success';
  }

  return undefined;
}
