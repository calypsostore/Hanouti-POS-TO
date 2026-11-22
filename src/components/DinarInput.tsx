import type { InputHTMLAttributes } from 'react';
import {
  formatDinarInput,
  formatMillimesWithThousands,
  parseNonNegativeMillimes,
  preserveDinarInputCursor,
} from '../lib/millimes';

export interface DinarInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'step' | 'min'> {
  allowZero?: boolean;
}

export function DinarInput({ allowZero = true, ...props }: DinarInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      min={allowZero ? '0' : '0.001'}
      step="0.001"
      onChange={(event) => {
        const cursor = event.target.selectionStart ?? event.target.value.length;
        const next = event.target.value;
        const formatted = next === '' ? '' : formatDinarInput(next);
        event.target.value = formatted;
        const nextCursor = preserveDinarInputCursor(next, formatted, cursor);
        props.onChange?.(event);
        window.requestAnimationFrame(() => event.target.setSelectionRange(nextCursor, nextCursor));
      }}
      onBlur={(event) => {
        props.onBlur?.(event);
        if (event.target.value === '') return;
        const millimes = parseNonNegativeMillimes(event.target.value);
        if (millimes !== undefined) {
          event.target.value = formatMillimesWithThousands(millimes);
          props.onChange?.(event);
        }
      }}
    />
  );
}
