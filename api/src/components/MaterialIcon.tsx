interface MaterialIconProps {
  name: string;
  className?: string;
  filled?: boolean;
}

function getSemanticIconColor(name: string): string | undefined {
  if (
    name === 'delete'
    || name === 'delete_outline'
    || name === 'delete_sweep'
    || name === 'cancel'
    || name === 'block'
    || name === 'dangerous'
    || name === 'error'
    || name === 'error_outline'
    || name === 'report'
    || name === 'person_off'
  ) {
    return 'rgb(var(--color-error-dark))';
  }
  if (
    name === 'remove'
    || name === 'remove_circle'
    || name === 'remove_circle_outline'
    || name === 'lightbulb'
    || name === 'warning'
    || name === 'warning_amber'
    || name === 'report_problem'
    || name === 'priority_high'
  ) {
    return 'rgb(234 179 8)';
  }
  if (
    name === 'check'
    || name === 'check_circle'
    || name === 'done'
    || name === 'done_all'
    || name === 'verified'
    || name === 'verified_user'
  ) {
    return 'rgb(var(--color-success-dark))';
  }
  return undefined;
}

export function MaterialIcon({ name, className = '', filled = false }: MaterialIconProps) {
  const hasExplicitColor = /(?:^|\s)(?:text-(?:white|on-primary|on-success|on-error|on-warning)|!text-[^\s]+)/.test(className);
  const semanticColor = hasExplicitColor ? undefined : getSemanticIconColor(name);

  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      style={{
        ...(semanticColor ? { color: semanticColor } : {}),
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}`,
      }}
    >
      {name}
    </span>
  );
}
