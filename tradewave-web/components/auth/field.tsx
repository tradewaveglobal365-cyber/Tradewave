'use client';

import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One labelled input with its error message.
 *
 * The a11y wiring is the whole point of this component: the label is bound to
 * the control, the error is announced, and aria-invalid/aria-describedby are set
 * only when there actually is an error. Screen readers otherwise announce an
 * empty description on every field.
 */
export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: (props: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[0.8125rem] font-medium text-foreground">
        {label}
      </label>

      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-[0.75rem] leading-snug text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[0.75rem] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
