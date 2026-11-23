export interface RetryReadOptions {
  attempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  isRetryable?: (error: unknown) => boolean;
}

function isLikelyNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('temporarily') ||
    message.includes('failed to fetch');
}

export async function retryRead<T>(
  operation: () => Promise<T>,
  options: RetryReadOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 250);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const isRetryable = options.isRetryable ?? isLikelyNetworkError;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('The read request timed out.')), timeoutMs);
        }),
      ]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryable(error)) throw error;
      const jitter = Math.floor(Math.random() * Math.max(1, baseDelayMs));
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** attempt) + jitter));
    }
  }
  throw lastError;
}
