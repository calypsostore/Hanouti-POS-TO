import { MaterialIcon } from './MaterialIcon';
import { t } from '../i18n/translations';

interface KeypadProps {
  onPress: (value: string) => void;
  onClear: () => void;
  onBackspace: () => void;
  disabled?: boolean;
  decimal?: boolean;
  className?: string;
}

export function Keypad({ onPress, onClear, onBackspace, disabled = false, decimal = false, className = '' }: KeypadProps) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className={`grid gap-2 ${decimal ? 'grid-cols-4' : 'grid-cols-3'} ${className}`}>
      {keys.map((key) => (
        <button key={key} type="button" disabled={disabled} onClick={() => onPress(key)} className="flex h-14 items-center justify-center rounded-xl bg-surface-container font-display text-headline-md text-on-surface active:bg-primary-fixed disabled:opacity-40">
          {key}
        </button>
      ))}
      <button type="button" disabled={disabled} onClick={onClear} className="h-14 rounded-xl bg-surface-container-high font-body text-label-md text-on-surface-variant disabled:opacity-40">{t('keypad.clear')}</button>
      <button type="button" disabled={disabled} onClick={() => onPress('0')} className="h-14 rounded-xl bg-surface-container font-display text-headline-md text-on-surface disabled:opacity-40">0</button>
      {decimal && <button type="button" disabled={disabled} onClick={() => onPress('.')} aria-label="Decimal point" className="h-14 rounded-xl bg-surface-container font-display text-headline-md text-on-surface disabled:opacity-40">.</button>}
      <button type="button" disabled={disabled} aria-label={t('keypad.deleteDigit')} onClick={onBackspace} className="flex h-14 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant disabled:opacity-40">
        <MaterialIcon name="backspace" />
      </button>
    </div>
  );
}
