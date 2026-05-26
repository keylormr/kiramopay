import type { HTMLAttributes, ReactNode } from 'react';

type Elevation = 1 | 2 | 3;
type Padding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: Elevation;
  padding?: Padding;
  interactive?: boolean;
  /** Visual variant: 'default' = surface-tier; 'brand' = navy→electric gradient with white text. */
  variant?: 'default' | 'brand' | 'subtle';
  children?: ReactNode;
}

const PADDING: Record<Padding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

const SHADOW: Record<Elevation, string> = {
  1: 'uv-shadow-soft',
  2: 'uv-shadow-elevated',
  3: 'uv-shadow-floating',
};

const SURFACE: Record<Elevation, string> = {
  1: 'uv-surface-1',
  2: 'uv-surface-2',
  3: 'uv-surface-3',
};

export function Card({
  elevation = 1,
  padding = 'md',
  interactive = false,
  variant = 'default',
  className = '',
  children,
  ...rest
}: CardProps) {
  let base: string;
  if (variant === 'brand') {
    base = 'uv-gradient-brand text-white border border-white/10';
  } else if (variant === 'subtle') {
    base = 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)]';
  } else {
    base = SURFACE[elevation];
  }

  return (
    <div
      className={`rounded-2xl ${base} ${SHADOW[elevation]} ${PADDING[padding]} ${interactive ? 'card-interactive cursor-pointer' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
