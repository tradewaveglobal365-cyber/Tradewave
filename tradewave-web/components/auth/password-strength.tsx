'use client';

/**
 * A length-and-variety heuristic, shown on signup only.
 *
 * This is a nudge, not a gate — the API owns the actual policy (8+ characters
 * and not on the common-password denylist). Deliberately rewards LENGTH far
 * more than symbol variety, because that is what actually resists cracking.
 */
export function scorePassword(value: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!value) return { score: 0, label: '' };

  let points = 0;
  if (value.length >= 8) points += 1;
  if (value.length >= 12) points += 1;
  if (value.length >= 16) points += 1;
  if (/\s/.test(value) && value.trim().split(/\s+/).length >= 3) points += 1; // passphrase
  if (/[^A-Za-z0-9]/.test(value)) points += 1;
  if (/\d/.test(value) && /[A-Za-z]/.test(value)) points += 1;

  if (value.length < 8) return { score: 0, label: 'Too short' };
  if (points <= 2) return { score: 1, label: 'Weak' };
  if (points <= 4) return { score: 2, label: 'Good' };
  return { score: 3, label: 'Strong' };
}

const BAR_COLOR = ['bg-border', 'bg-destructive', 'bg-pending', 'bg-gain'] as const;
const TEXT_COLOR = ['text-muted-foreground', 'text-destructive', 'text-pending', 'text-gain'] as const;

export function PasswordStrength({ value }: { value: string }) {
  const { score, label } = scorePassword(value);
  if (!value) return null;

  return (
    <div className="flex items-center gap-2 pt-0.5">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded-full transition-colors ${
              score >= step ? BAR_COLOR[score] : 'bg-border'
            }`}
          />
        ))}
      </div>
      <span className={`text-[0.6875rem] font-medium tabular-nums ${TEXT_COLOR[score]}`}>
        {label}
      </span>
      <span className="sr-only" role="status">
        Password strength: {label}
      </span>
    </div>
  );
}
