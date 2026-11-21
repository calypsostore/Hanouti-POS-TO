import { getLogoDefinition } from '../data/logoCatalog';
import { MaterialIcon } from './MaterialIcon';

type LogoSize = 'sm' | 'md' | 'lg';

interface ItemLogoProps {
  id: string;
  size?: LogoSize;
  className?: string;
}

const sizeClasses: Record<LogoSize, { tile: string; icon: string; image: string }> = {
  sm: { tile: 'h-8 w-8 rounded-lg', icon: 'text-lg', image: 'h-7 w-7' },
  md: { tile: 'h-12 w-12 rounded-xl', icon: 'text-2xl', image: 'h-10 w-10' },
  lg: { tile: 'h-20 w-20 rounded-xl', icon: 'text-3xl', image: 'h-[4.5rem] w-[4.5rem]' },
};

export function ItemLogo({ id, size = 'md', className = '' }: ItemLogoProps) {
  const logo = getLogoDefinition(id);
  const classes = sizeClasses[size];

  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center overflow-hidden bg-surface-container text-primary ${classes.tile} ${className}`}>
      {logo ? (
        <img src={logo.src} alt="" loading="lazy" decoding="async" className={`${classes.image} object-contain`} />
      ) : id ? (
        <MaterialIcon name={id} className={classes.icon} />
      ) : null}
    </span>
  );
}
