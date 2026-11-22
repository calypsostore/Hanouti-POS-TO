export function parseNonNegativeMillimes(value: string): number | undefined {
  const trimmed = value.trim().replace(/\s/g, '').replace(/,/g, '.');
  if (!/^(?:\d+)(?:\.\d{0,3})?$/.test(trimmed)) return undefined;

  const [dinarsText, decimalsText = ''] = trimmed.split('.');
  if (!/^\d+$/.test(dinarsText)) return undefined;

  const dinars = dinarsText.replace(/^0+(?=\d)/, '');
  const decimals = decimalsText.padEnd(3, '0');
  const millimes = Number(dinars) * 1000 + Number(decimals);
  return Number.isSafeInteger(millimes) && millimes >= 0 ? millimes : undefined;
}

export function formatMillimes(amountMillimes: number): string {
  if (!Number.isSafeInteger(amountMillimes) || amountMillimes < 0) return '—';
  const dinars = Math.floor(amountMillimes / 1000);
  const millimes = amountMillimes % 1000;
  return `${dinars}.${String(millimes).padStart(3, '0')}`;
}
