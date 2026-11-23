function localSecretProcessingDisabled(): never {
  throw new Error('Local secret processing is disabled in production builds.');
}

export async function hashSecret(_secret: string): Promise<string> {
  return localSecretProcessingDisabled();
}

export async function verifySecret(
  _stored: string | undefined,
  _candidate: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  return localSecretProcessingDisabled();
}
