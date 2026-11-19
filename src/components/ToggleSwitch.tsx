interface ToggleSwitchProps {
  checked: boolean;
  label: string;
  onChange: () => void;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, label, onChange, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="inline-flex h-12 w-12 min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-primary' : 'bg-outline-variant'}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow-card transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}
