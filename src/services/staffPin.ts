const PREDICTABLE_PINS = new Set([
  '0123', '1234', '2345', '3456', '4567', '5678', '6789', '7890', '8901', '9012',
  '9876', '8765', '7654', '6543', '5432', '4321', '3210', '2109', '1098', '0987',
  '0246', '1357', '2468', '3579', '8642', '7531', '6420', '9753',
  '1470', '2580', '3690', '0852', '0741', '0963',
]);

export function isAcceptableStaffPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin) || PREDICTABLE_PINS.has(pin)) return false;
  const [first, second, third, fourth] = pin;
  return !(
    first === second && second === third ||
    second === third && third === fourth ||
    first === second && third === fourth ||
    first === third && second === fourth ||
    first === fourth && second === third
  );
}

function randomFourDigitPin(): string {
  const random = new Uint16Array(1);
  let value: number;
  do {
    crypto.getRandomValues(random);
    value = random[0];
  } while (value >= 60_000);
  return String(value % 10_000).padStart(4, '0');
}

export async function generateStaffPin(isUnique: (pin: string) => Promise<boolean>): Promise<string> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const pin = randomFourDigitPin();
    if (isAcceptableStaffPin(pin) && await isUnique(pin)) return pin;
  }
  throw new Error('Unable to generate an available staff PIN. Try again.');
}
