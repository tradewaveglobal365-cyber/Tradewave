/**
 * The email design system.
 *
 * Mirrors services/documents/layout.ts, which does the same job for the PDFs:
 * one place where a colour, a font stack or an email-client quirk is decided,
 * so a certificate and a receipt read as the same company.
 *
 * ── Blocks, not strings ───────────────────────────────────────────────────
 * Every template used to write its HTML and its plain text by hand, and the
 * two had already drifted — one listed a row the other omitted. A template now
 * returns a Block[] and both parts are rendered from it, so they cannot
 * disagree and a copy change happens once.
 *
 * ── Why the markup looks dated ────────────────────────────────────────────
 * Tables, inline styles, bgcolor attributes and a VML button are not stylistic
 * choices. Outlook renders through Word, which ignores max-width on tables, does
 * not inherit font-family into cells, drops border-radius, and ignores borders
 * declared on a <tr>. Everything below that looks like 2004 is there because a
 * real client needs it.
 */

import { env } from '../../config/env';

/**
 * The chevron mark, served from the web app's public directory.
 *
 * Derived from WEB_ORIGIN rather than configured separately, so it follows the
 * site the same way every link in the body already does — and so there is no
 * second thing to remember when the domain finally changes.
 *
 * Rendered at 2x and displayed at 28, because Outlook scales a 1x image badly.
 * The background is baked to the canvas colour rather than left transparent: a
 * client forcing dark mode would otherwise put a dark-green mark on a dark
 * ground and lose it entirely, where a light chip stays legible.
 */
const MARK_URL = `${env.WEB_ORIGIN}/email/tradewave-mark.png`;
const MARK_PX = 28;

/**
 * Straight from tradewave-web/app/globals.css.
 *
 * Duplicated rather than imported because the API cannot read the web app's
 * CSS. If the brand moves, both move — the same trade the PDF layout makes.
 */
export const COLOURS = {
  /** Chrome and interaction. */
  brand900: '#0B3D2E',
  brand700: '#12664B',
  gold500: '#C8A94A',

  canvas: '#FBFAF7',
  surface: '#FFFFFF',
  hairline: '#E5E2DA',
  ink: '#0E1512',
  subtle: '#5C6660',

  /**
   * Positive numbers ONLY, and deliberately a different green from the brand.
   * globals.css says why: "so a filled button can never be misread as a +12.4%
   * return". Never use brand green for a figure.
   */
  gain: '#16A34A',
  pending: '#D97706',
  loss: '#DC2626',
} as const;

/**
 * Pill backgrounds, with the app's alpha flattened against white.
 *
 * The product writes `bg-gain/10`; email has no colour-mix, so these are the
 * same colours resolved once here rather than guessed per template.
 */
const PILL = {
  gain: { fg: COLOURS.gain, bg: '#E8F6EE' },
  pending: { fg: COLOURS.pending, bg: '#FBF0E1' },
  loss: { fg: COLOURS.loss, bg: '#FCE9E9' },
} as const;

/**
 * Geist is the app's typeface and is not web-safe, so email falls back to the
 * system stack. Declared on every cell, not just <body> — Outlook does not
 * inherit it into tables, which is why figure tables used to render in Times.
 */
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const WIDTH = 600;

// ── Blocks ───────────────────────────────────────────────────────────────────

export type Block =
  | { kind: 'text'; text: string; strong?: boolean }
  /** A big money number with a label. `gain` renders green — see COLOURS. */
  | { kind: 'figure'; label: string; value: string; tone?: 'gain' }
  /** The labelled receipt table. */
  | { kind: 'rows'; pairs: [string, string][] }
  /** A security callout: money moved, access changed, was this you. */
  | { kind: 'notice'; text: string }
  | { kind: 'pill'; label: string; tone: 'gain' | 'pending' | 'loss' }
  /** Small print under the main body. */
  | { kind: 'footnote'; text: string };

export interface Message {
  subject: string;
  /** The inbox preview line. Without one, clients show the first sentence. */
  preheader: string;
  heading: string;
  blocks: Block[];
  cta?: { label: string; url: string } | undefined;
  /** Marketing only. Transactional mail never carries one. */
  unsubscribeUrl?: string | undefined;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/**
 * Escapes a URL for an href.
 *
 * Every url reaching here is built from WEB_ORIGIN plus a token we generated,
 * so this is belt-and-braces rather than a live hole — but an unescaped `"` in
 * an href is an attribute break, and that is not a thing to leave to luck.
 */
function escapeUrl(value: string): string {
  return escapeHtml(value.replace(/[\s]/g, ''));
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const td = (extra = '') =>
  `font-family:${FONT};font-size:15px;line-height:1.6;color:${COLOURS.subtle};${extra}`;

function blockHtml(block: Block): string {
  switch (block.kind) {
    case 'text':
      return `<p style="margin:0 0 14px;${td()}">${
        block.strong
          ? `<strong style="color:${COLOURS.ink};">${escapeHtml(block.text)}</strong>`
          : escapeHtml(block.text)
      }</p>`;

    case 'figure':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
        <td style="font-family:${FONT};font-size:12px;font-weight:500;color:${COLOURS.subtle};padding:0 0 6px;">${escapeHtml(block.label)}</td>
      </tr><tr>
        <td style="font-family:${FONT};font-size:28px;line-height:1;font-weight:600;letter-spacing:-0.02em;color:${
          block.tone === 'gain' ? COLOURS.gain : COLOURS.ink
        };">${escapeHtml(block.value)}</td>
      </tr></table>`;

    case 'rows':
      // Borders live on the <td>, not the <tr>: Outlook ignores them on a row,
      // which is why the receipt tables had no lines there.
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border:1px solid ${COLOURS.hairline};">
        ${block.pairs
          .map(
            ([label, value], i) => `<tr>
            <td style="font-family:${FONT};font-size:13px;color:${COLOURS.subtle};padding:10px 14px;${
              i > 0 ? `border-top:1px solid ${COLOURS.hairline};` : ''
            }">${escapeHtml(label)}</td>
            <td align="right" style="font-family:${FONT};font-size:13px;font-weight:600;color:${COLOURS.ink};padding:10px 14px;${
              i > 0 ? `border-top:1px solid ${COLOURS.hairline};` : ''
            }">${escapeHtml(value)}</td>
          </tr>`,
          )
          .join('')}
      </table>`;

    case 'notice':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
        <td bgcolor="${PILL.pending.bg}" style="background:${PILL.pending.bg};border-left:3px solid ${COLOURS.pending};padding:12px 14px;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLOURS.ink};">${escapeHtml(block.text)}</td>
      </tr></table>`;

    case 'pill': {
      const tone = PILL[block.tone];
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
        <td bgcolor="${tone.bg}" style="background:${tone.bg};border-radius:999px;padding:3px 10px;font-family:${FONT};font-size:11px;font-weight:600;color:${tone.fg};">${escapeHtml(block.label)}</td>
      </tr></table>`;
    }

    case 'footnote':
      return `<p style="margin:0 0 14px;font-family:${FONT};font-size:12px;line-height:1.6;color:${COLOURS.subtle};">${escapeHtml(block.text)}</p>`;
  }
}

/** The CTA, with a VML rectangle behind it so Outlook draws a real button. */
function buttonHtml(cta: { label: string; url: string }): string {
  const url = escapeUrl(cta.url);
  const label = escapeHtml(cta.label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;"><tr><td>
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:240px;" arcsize="18%" stroke="f" fillcolor="${COLOURS.brand700}">
      <w:anchorlock/>
      <center style="color:#FFFFFF;font-family:${FONT};font-size:15px;font-weight:600;">${label}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${url}" style="display:inline-block;background:${COLOURS.brand700};color:#FFFFFF;text-decoration:none;padding:13px 24px;border-radius:8px;font-family:${FONT};font-size:15px;font-weight:600;">${label}</a>
    <!--<![endif]-->
  </td></tr></table>`;
}

export function renderHtml(message: Message): string {
  const body = message.blocks.map(blockHtml).join('');

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- The palette is chosen; a client inverting it is a client getting it wrong. -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(message.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:${COLOURS.canvas};" bgcolor="${COLOURS.canvas}">
<!-- Inbox preview text. The padding characters stop the body copy bleeding in
     after it, which is why so many previews read "...View in browser". -->
<div style="display:none;font-size:1px;color:${COLOURS.canvas};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(message.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOURS.canvas}" style="background:${COLOURS.canvas};">
<tr><td align="center" style="padding:32px 16px;">

<!--[if mso]><table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px;margin:0 auto;">

  <!-- Letterhead: the mark and wordmark lockup the site header uses, over the
       gold rule the PDFs use.

       Deliberately split in two. Gmail blocks remote images by default and
       strips inline SVG outright, so a logo that is ONLY an image is missing
       for a large share of readers — on transactional mail about somebody's
       money, that is the worst moment to look unfamiliar. The mark is the
       image; the name stays live text. Images on, this is the site header.
       Images off, it degrades to exactly the wordmark that shipped before.

       alt is empty on purpose: the wordmark beside it already says Tradewave,
       and alt text here would render the name twice whenever images are off. -->
  <tr><td style="padding:0 0 18px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="padding-right:10px;line-height:0;">
        <img src="${escapeUrl(MARK_URL)}" width="${MARK_PX}" height="${MARK_PX}" alt="" style="display:block;width:${MARK_PX}px;height:${MARK_PX}px;border:0;outline:none;text-decoration:none;">
      </td>
      <td valign="middle" style="font-family:${FONT};font-size:20px;font-weight:600;letter-spacing:-0.02em;color:${COLOURS.brand900};">Tradewave</td>
    </tr></table>
    <div style="height:2px;width:36px;background:${COLOURS.gold500};font-size:0;line-height:0;margin-top:8px;">&nbsp;</div>
  </td></tr>

  <tr><td bgcolor="${COLOURS.surface}" style="background:${COLOURS.surface};border:1px solid ${COLOURS.hairline};border-radius:14px;padding:32px;">
    <h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:${COLOURS.ink};">${escapeHtml(message.heading)}</h1>
    ${body}
    ${message.cta ? buttonHtml(message.cta) : ''}
  </td></tr>

  <tr><td style="padding:18px 4px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${COLOURS.subtle};">
    Tradewave &middot; Fractional Dubai real estate<br>
    You are receiving this because you have a Tradewave account.
    ${
      message.unsubscribeUrl
        ? `<br><a href="${escapeUrl(message.unsubscribeUrl)}" style="color:${COLOURS.subtle};">Unsubscribe from updates like this</a>`
        : ''
    }
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->

</td></tr>
</table>
</body>
</html>`;
}

// ── Plain text ───────────────────────────────────────────────────────────────

function blockText(block: Block): string {
  switch (block.kind) {
    case 'text':
      return block.text;
    case 'figure':
      return `${block.label}: ${block.value}`;
    case 'rows':
      return block.pairs.map(([label, value]) => `${label}: ${value}`).join('\n');
    case 'notice':
      return block.text;
    case 'pill':
      return block.label;
    case 'footnote':
      return block.text;
  }
}

export function renderText(message: Message): string {
  const parts = [message.heading, '', ...message.blocks.map(blockText)];
  if (message.cta) parts.push('', `${message.cta.label}: ${message.cta.url}`);
  if (message.unsubscribeUrl) {
    parts.push('', `Unsubscribe: ${message.unsubscribeUrl}`);
  }
  parts.push('', 'Tradewave · Fractional Dubai real estate');
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** What every template returns, and what the drivers send. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function render(message: Message): RenderedEmail {
  return {
    // Escaped: subjects interpolate values an admin controls, such as a
    // property title, and a subject is not an HTML context but is not a safe
    // place for a stray control character either.
    subject: message.subject.replace(/[\r\n]+/g, ' ').trim(),
    html: renderHtml(message),
    text: renderText(message),
  };
}
