/**
 * Turning a user-agent string into something a person recognises.
 *
 * Deliberately small. A full UA database would be more accurate and is not
 * worth a dependency here: this text appears in exactly one place — the
 * "signed in from a new device" email — where its only job is to help somebody
 * answer "was that me?". "Chrome on Windows" does that. "Mozilla/5.0
 * (Windows NT 10.0; Win64; x64) AppleWebKit/537.36..." does not.
 *
 * Order matters in both tables below: Edge and Opera both claim to be Chrome,
 * and every browser on iOS is Safari underneath, so the more specific token has
 * to be tested first.
 */

const BROWSERS: [RegExp, string][] = [
  [/\bEdgA?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\//, 'Chrome'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

const first = (table: [RegExp, string][], ua: string): string | null =>
  table.find(([re]) => re.test(ua))?.[1] ?? null;

/**
 * A short, human phrase for a user agent.
 *
 * Returns a deliberately vague fallback rather than the raw string: an
 * unparsed UA in an email body is noise to the reader and a small disclosure to
 * anyone else who sees it.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return 'an unrecognised device';

  const browser = first(BROWSERS, userAgent);
  const platform = first(PLATFORMS, userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return 'an unrecognised device';
}

/** The timestamp shown beside it. UTC, matching how sessions are stored. */
export function describeWhen(at: Date): string {
  const date = at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${date}, ${time} UTC`;
}
