'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CalendarClock, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { WithdrawalWindowSettings, WithdrawalWindowState } from '@/lib/admin';

/**
 * When investors may ask for money.
 *
 * A setting rather than a constant, because the first public holiday or bank
 * outage that lands on payout day needs moving that morning, not next release.
 *
 * This gates the INVESTOR's request only — approving and sending stay open at
 * any hour, so a request made ten minutes before closing can still be finished.
 */
const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

/** Minutes from midnight <-> the "HH:MM" an <input type="time"> speaks. */
function toTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
function toMinute(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function WithdrawalWindowForm({
  window,
  state,
}: {
  window: WithdrawalWindowSettings;
  state: WithdrawalWindowState;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(window.paused);
  const [pausedReason, setPausedReason] = useState(window.pausedReason ?? '');
  const [enabled, setEnabled] = useState(window.enabled);
  const [days, setDays] = useState<number[]>(window.daysOfWeek);
  const [opens, setOpens] = useState(toTime(window.opensAtMinute));
  const [closes, setCloses] = useState(toTime(window.closesAtMinute));
  const [timezone, setTimezone] = useState(window.timezone);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opensAtMinute = toMinute(opens);
  const closesAtMinute = toMinute(closes);
  const valid =
    opensAtMinute !== null &&
    closesAtMinute !== null &&
    closesAtMinute > opensAtMinute &&
    (!enabled || days.length > 0) &&
    // A pause with no explanation is the shape of a scam — investors are shown
    // this sentence when their withdrawal is refused.
    (!paused || pausedReason.trim().length > 0);

  function toggleDay(value: number) {
    setSaved(false);
    setDays((current) =>
      current.includes(value) ? current.filter((d) => d !== value) : [...current, value],
    );
  }

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/admin/withdrawal-window', {
        method: 'POST',
        body: {
          paused,
          pausedReason: paused ? pausedReason.trim() : undefined,
          enabled,
          daysOfWeek: days,
          opensAtMinute,
          closesAtMinute,
          timezone,
        },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      // The API's own wording names what is wrong with the schedule — a closing
      // time before the opening one, a timezone it does not recognise.
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[0.875rem] font-medium text-foreground">
            <CalendarClock className="size-3.5 text-muted-foreground" />
            Payout schedule
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
            When investors can ask. You can approve and send at any time — this only closes
            the door on new requests, so nobody is left with money out of their balance
            waiting for a payout day.
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${
            paused
              ? 'bg-destructive/10 text-destructive'
              : state.open
                ? 'bg-gain/10 text-gain'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {paused ? 'Paused' : state.open ? 'Open now' : 'Closed'}
        </span>
      </div>

      {/* The kill switch. Deliberately above the schedule and styled apart from
          it: "no schedule" and "nothing may leave" are opposite things, and one
          checkbox meaning both is how somebody opens the gates by accident. */}
      <div
        className={`mt-4 rounded-lg border px-3 py-3 ${
          paused ? 'border-destructive/40 bg-destructive/5' : 'border-hairline'
        }`}
      >
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={paused}
            onChange={(e) => {
              setPaused(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5 size-4 shrink-0 rounded border-input accent-destructive"
          />
          <span className="text-[0.8125rem] text-foreground">
            Pause all withdrawals
            <span className="mt-0.5 block text-[0.75rem] text-muted-foreground">
              Stops every withdrawal for everybody, whatever the schedule below says. For a
              provider outage, an empty float, or while you are investigating something.
            </span>
          </span>
        </label>

        {paused ? (
          <div className="mt-3">
            <label
              htmlFor="paused-reason"
              className="block text-[0.75rem] font-medium text-foreground"
            >
              Reason investors are shown
            </label>
            <input
              id="paused-reason"
              value={pausedReason}
              onChange={(e) => {
                setPausedReason(e.target.value);
                setSaved(false);
              }}
              placeholder="e.g. Our payment provider is having an outage"
              className="mt-1 h-10 w-full rounded-lg border border-input bg-transparent px-3 text-[0.8125rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
            {pausedReason.trim() === '' ? (
              <p role="alert" className="mt-1 text-[0.75rem] text-destructive">
                Give a reason — it is shown to anyone who tries to withdraw.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <label className="mt-4 flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
          className="mt-0.5 size-4 shrink-0 rounded border-input accent-brand-700"
        />
        <span className="text-[0.8125rem] text-foreground">
          Run withdrawals on a schedule
          <span className="mt-0.5 block text-[0.75rem] text-muted-foreground">
            Unchecked, investors can request any day at any time.
          </span>
        </span>
      </label>

      <fieldset disabled={!enabled} className="mt-4 space-y-4 disabled:opacity-50">
        <div>
          <legend className="text-[0.8125rem] font-medium text-foreground">Payout days</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DAYS.map((day) => {
              const on = days.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDay(day.value)}
                  aria-pressed={on}
                  className={`h-9 min-w-12 rounded-lg border px-3 text-[0.8125rem] font-medium transition-colors ${
                    on
                      ? 'border-brand-700 bg-brand-700 text-white'
                      : 'border-input text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          {enabled && days.length === 0 ? (
            <p role="alert" className="mt-1.5 text-[0.75rem] text-destructive">
              Pick at least one day, or switch the schedule off.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-4">
          <div>
            <label
              htmlFor="opens-at"
              className="block text-[0.8125rem] font-medium text-foreground"
            >
              Opens
            </label>
            <input
              id="opens-at"
              type="time"
              value={opens}
              onChange={(e) => {
                setOpens(e.target.value);
                setSaved(false);
              }}
              className="mt-1.5 h-10 rounded-lg border border-input bg-transparent px-3 text-[0.875rem] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
          </div>
          <div>
            <label
              htmlFor="closes-at"
              className="block text-[0.8125rem] font-medium text-foreground"
            >
              Closes
            </label>
            <input
              id="closes-at"
              type="time"
              value={closes}
              onChange={(e) => {
                setCloses(e.target.value);
                setSaved(false);
              }}
              className="mt-1.5 h-10 rounded-lg border border-input bg-transparent px-3 text-[0.875rem] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
          </div>
          <div className="min-w-48 flex-1">
            <label
              htmlFor="timezone"
              className="block text-[0.8125rem] font-medium text-foreground"
            >
              Timezone
            </label>
            <input
              id="timezone"
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                setSaved(false);
              }}
              placeholder="Africa/Lagos"
              className="mt-1.5 h-10 w-full rounded-lg border border-input bg-transparent px-3 text-[0.875rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
          </div>
        </div>

        {opensAtMinute !== null && closesAtMinute !== null && closesAtMinute <= opensAtMinute ? (
          <p role="alert" className="text-[0.75rem] text-destructive">
            The closing time has to be after the opening time.
          </p>
        ) : null}
      </fieldset>

      {error ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.75rem] text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={save} disabled={busy || !valid} className="h-10">
          {busy ? 'Saving…' : 'Save schedule'}
        </Button>
        {saved ? (
          <span className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
            <Check className="size-3.5" />
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
