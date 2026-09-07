export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[1.625rem] font-semibold tracking-[-0.025em] text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

/** Shared empty state, so every unbuilt section reads as deliberate. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-surface/50 px-6 py-14 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
        {icon}
      </div>
      <p className="mt-4 text-[0.9375rem] font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[0.875rem] leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
