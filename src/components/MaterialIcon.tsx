interface MaterialIconProps {
  name: string;
  className?: string;
  filled?: boolean;
}

export function MaterialIcon({ name, className = '', filled = false }: MaterialIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}` }}
    >
      {name}
    </span>
  );
}
