import type { InputHTMLAttributes } from 'react';
import {
  formatDinarInput,
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
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key !== '.' && event.key !== ',') return;
        const dotIndex = event.currentTarget.value.indexOf('.');
        if (dotIndex < 0) return;
        event.preventDefault();
        event.currentTarget.setSelectionRange(dotIndex + 1, event.currentTarget.value.length);
      }}
      onChange={(event) => {
        const cursor = event.target.selectionStart ?? event.target.value.length;
        const next = event.target.value;
        const formatted = next === '' ? '' : formatDinarInput(next);
        event.target.value = formatted;
        const nextCursor = cursor === next.length
          ? formatted.length
          : preserveDinarInputCursor(next, formatted, cursor);
        props.onChange?.(event);
        window.requestAnimationFrame(() => event.target.setSelectionRange(nextCursor, nextCursor));
      }}
      onBlur={(event) => {
        props.onBlur?.(event);
        if (event.target.value === '') return;
        const formatted = formatDinarInput(event.target.value);
        if (formatted !== event.target.value) {
          event.target.value = formatted;
          props.onChange?.(event);
        }
      }}
    />
  );
}
