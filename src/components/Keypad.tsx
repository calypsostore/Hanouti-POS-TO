import { MaterialIcon } from './MaterialIcon';

interface KeypadProps {
  onPress: (value: string) => void;
  onClear: () => void;
  onBackspace: () => void;
}

export function Keypad({ onPress, onClear, onBackspace }: KeypadProps) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((key) => (
        <button key={key} type="button" onClick={() => onPress(key)} className="flex h-14 items-center justify-center rounded-xl bg-surface-container font-display text-headline-md text-on-surface active:bg-primary-fixed">
          {key}
        </button>
      ))}
      <button type="button" onClick={onClear} className="h-14 rounded-xl bg-surface-container-high font-body text-label-md text-on-surface-variant">CLR</button>
      <button type="button" onClick={() => onPress('0')} className="h-14 rounded-xl bg-surface-container font-display text-headline-md text-on-surface">0</button>
      <button type="button" aria-label="Delete last digit" onClick={onBackspace} className="flex h-14 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant">
        <MaterialIcon name="backspace" />
      </button>
    </div>
  );
}
