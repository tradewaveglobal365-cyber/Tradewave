import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest } from '../../lib/errors';

/**
 * The schedule investors may ask for money on.
 *
 * ── Why the REQUEST is gated and not just the payout ──────────────────────
 * Because the alternative reads as fraud. If somebody can ask on Tuesday and
 * the money only moves on Friday, then for three days their balance is lower
 * and nothing has arrived — which is indistinguishable, from where they sit,
 * from a platform that has taken their money. Asking and being paid on the
 * same day is the honest shape of a weekly payout.
 *
 * ── Why it does NOT gate staff ────────────────────────────────────────────
 * approveWithdrawal has no window check. A request made at 16:55 has to be
 * finishable at 17:30, and a Klasha outage on payout day has to be catchable
 * the next morning. Closing the door on the people doing the paying would
 * strand exactly the money this schedule exists to move.
 */

const SINGLETON_ID = 'singleton';

/** Sunday-first, matching JavaScript's getDay() and Intl's weekday order. */
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MINUTES_PER_DAY = 24 * 60;

export interface WithdrawalWindowView {
  enabled: boolean;
  daysOfWeek: number[];
  opensAtMinute: number;
  closesAtMinute: number;
  timezone: string;
  updatedAt: Date;
}

/**
 * The schedule, creating the default on first read.
 *
 * Upserted rather than seeded: a migration that inserts a row is one more
 * thing that can be skipped on a fresh environment, and the failure mode there
 * is withdrawals silently accepting requests every day of the week.
 */
export async function getWindow(): Promise<WithdrawalWindowView> {
  const row = await prisma.withdrawalWindow.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
  return {
    enabled: row.enabled,
    daysOfWeek: [...row.daysOfWeek].sort((a, b) => a - b),
    opensAtMinute: row.opensAtMinute,
    closesAtMinute: row.closesAtMinute,
    timezone: row.timezone,
    updatedAt: row.updatedAt,
  };
}

export interface WindowState {
  open: boolean;
  /** When it next opens. Null when it is open now, or when there is no schedule. */
  opensAt: Date | null;
  /** When the current opening ends. Null unless it is open now. */
  closesAt: Date | null;
}

export function evaluateWindow(
  window: WithdrawalWindowView,
  now = new Date(),
): WindowState {
  if (!window.enabled || window.daysOfWeek.length === 0) {
    return { open: true, opensAt: null, closesAt: null };
  }

  const { weekday, minuteOfDay, year, month, day } = zonedParts(now, window.timezone);

  const openToday =
    window.daysOfWeek.includes(weekday) &&
    minuteOfDay >= window.opensAtMinute &&
    minuteOfDay < window.closesAtMinute;

  if (openToday) {
    return {
      open: true,
      opensAt: null,
      closesAt: zonedToUtc(
        { year, month, day, minute: window.closesAtMinute },
        window.timezone,
      ),
    };
  }

  return { open: false, opensAt: nextOpening(window, now), closesAt: null };
}

/**
 * The next moment the window opens.
 *
 * Walks forward a day at a time rather than doing modular arithmetic on
 * weekdays. Eight iterations at most, and it stays obviously correct when the
 * schedule is several days a week — which the arithmetic version does not.
 */
function nextOpening(window: WithdrawalWindowView, now: Date): Date | null {
  if (window.daysOfWeek.length === 0) return null;

  const today = zonedParts(now, window.timezone);

  for (let offset = 0; offset <= 7; offset += 1) {
    // Step in UTC days and re-read the zoned date, so a day that is 23 or 25
    // hours long somewhere does not shift the calendar date by one.
    const probe = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const parts = zonedParts(probe, window.timezone);
    if (!window.daysOfWeek.includes(parts.weekday)) continue;

    // Today only counts if the opening has not already passed.
    if (offset === 0 && today.minuteOfDay >= window.opensAtMinute) continue;

    return zonedToUtc(
      { year: parts.year, month: parts.month, day: parts.day, minute: window.opensAtMinute },
      window.timezone,
    );
  }

  return null;
}

// ── Timezone plumbing ────────────────────────────────────────────────────────

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minuteOfDay: number;
}

/** What the wall clock reads in `timeZone` at this instant. */
function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsOf(date, timeZone);
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  return { ...parts, weekday, minuteOfDay: parts.hour * 60 + parts.minute };
}

function partsOf(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const get = (type: string) =>
    Number(formatted.find((p) => p.type === type)?.value ?? '0');

  // Intl renders midnight as hour 24 in some engines. Normalise it.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * A wall-clock time in `timeZone`, as a real instant.
 *
 * Guess the instant as if the wall clock were UTC, measure how wrong that guess
 * is at that point in the year, and correct. One pass is exact for any zone
 * without DST — Lagos, which is UTC+1 all year — and the second pass makes it
 * right for zones that do shift, where the first guess can land on the wrong
 * side of a transition.
 */
function zonedToUtc(
  wall: { year: number; month: number; day: number; minute: number },
  timeZone: string,
): Date {
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    Math.floor(wall.minute / 60) % 24,
    wall.minute % 60,
  );

  let instant = asIfUtc - offsetMs(new Date(asIfUtc), timeZone);
  instant = asIfUtc - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** How far ahead of UTC `timeZone` is at this instant, in milliseconds. */
function offsetMs(date: Date, timeZone: string): number {
  const p = partsOf(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// ── Editing ──────────────────────────────────────────────────────────────────

export interface SetWindowInput {
  enabled: boolean;
  daysOfWeek: number[];
  opensAtMinute: number;
  closesAtMinute: number;
  timezone: string;
}

export async function setWindow(
  input: SetWindowInput,
  adminUserId: string,
): Promise<WithdrawalWindowView> {
  const days = [...new Set(input.daysOfWeek)].sort((a, b) => a - b);

  if (input.enabled && days.length === 0) {
    throw badRequest('Choose at least one day, or switch the schedule off entirely.', {
      daysOfWeek: 'Pick a day',
    });
  }
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw badRequest('Days must be between Sunday and Saturday.');
  }
  if (input.closesAtMinute <= input.opensAtMinute) {
    throw badRequest('The closing time has to be after the opening time.', {
      closesAtMinute: 'Must be after the opening time',
    });
  }
  if (input.opensAtMinute < 0 || input.closesAtMinute > MINUTES_PER_DAY) {
    throw badRequest('Times must fall inside a single day.');
  }
  if (!isValidTimezone(input.timezone)) {
    throw badRequest(`"${input.timezone}" is not a timezone this server recognises.`, {
      timezone: 'Not a recognised timezone',
    });
  }

  const row = await prisma.withdrawalWindow.upsert({
    where: { id: SINGLETON_ID },
    update: { ...input, daysOfWeek: days, updatedByUserId: adminUserId },
    create: { id: SINGLETON_ID, ...input, daysOfWeek: days, updatedByUserId: adminUserId },
  });

  logger.info(
    { adminUserId, days, enabled: input.enabled, timezone: input.timezone },
    'Withdrawal window changed',
  );

  return {
    enabled: row.enabled,
    daysOfWeek: [...row.daysOfWeek].sort((a, b) => a - b),
    opensAtMinute: row.opensAtMinute,
    closesAtMinute: row.closesAtMinute,
    timezone: row.timezone,
    updatedAt: row.updatedAt,
  };
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "Friday, 09:00 to 17:00" — one sentence the UI and the emails can share. */
export function describeWindow(window: WithdrawalWindowView): string {
  if (!window.enabled || window.daysOfWeek.length === 0) return 'any time';
  const days = window.daysOfWeek.map((d) => DAY_NAMES[d]).join(', ');
  return `${days}, ${formatMinute(window.opensAtMinute)} to ${formatMinute(window.closesAtMinute)}`;
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60)
    .toString()
    .padStart(2, '0');
  const m = (minute % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
