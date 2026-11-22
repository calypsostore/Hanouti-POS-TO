import type { InputHTMLAttributes } from 'react';

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
        const next = event.target.value;
        if (/^\d*(?:\.\d{0,3})?$/.test(next) || next === '') {
          props.onChange?.(event);
        }
      }}
    />
  );
}
