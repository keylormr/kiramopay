import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightAdornment?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helper,
    error,
    leftIcon,
    rightAdornment,
    className = '',
    containerClassName = '',
    id,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id || autoId;
  const stateBorder = error
    ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)]'
    : 'border-[var(--color-border)] focus:border-[var(--color-primary)] dark:border-[var(--color-border-dark)]';

  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium uv-text-secondary"
        >
          {label}
        </label>
      )}
      <div
        className={`relative flex items-center bg-[var(--color-surface-1)] dark:bg-[var(--color-surface-2-dark)] border ${stateBorder} rounded-lg transition-colors focus-within:ring-[3px] focus-within:ring-[var(--color-primary-soft)]`}
      >
        {leftIcon && (
          <span className="pl-3 uv-text-muted flex items-center pointer-events-none">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`flex-1 h-12 px-3 bg-transparent uv-text-primary placeholder:uv-text-muted outline-none ${className}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-err` : helper ? `${inputId}-help` : undefined}
          {...rest}
        />
        {rightAdornment && (
          <span className="pr-2 flex items-center">{rightAdornment}</span>
        )}
      </div>
      {error ? (
        <span
          id={`${inputId}-err`}
          className="text-xs font-medium text-[var(--color-danger)]"
        >
          {error}
        </span>
      ) : helper ? (
        <span id={`${inputId}-help`} className="text-xs uv-text-muted">
          {helper}
        </span>
      ) : null}
    </div>
  );
});
