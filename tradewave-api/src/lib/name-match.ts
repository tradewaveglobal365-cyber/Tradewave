/**
 * Does a bank account name belong to a verified person?
 *
 * This is the control that stops the platform paying an arbitrary third party.
 * It is its own module, and unit-tested on its own, because it is the piece that
 * decides whether money may leave.
 *
 * ── Why not an exact match ────────────────────────────────────────────────
 * Nigerian banks hold names in whatever order and form the account was opened
 * with. "Joshua Okoghie" legitimately appears as OKOGHIE JOSHUA, as
 * OKOGHIE JOSHUA EMMANUEL, and as J OKOGHIE. An exact comparison would refuse
 * almost every real customer, and a system that refuses honest people teaches
 * them to route around it.
 *
 * ── Why not a similarity score ────────────────────────────────────────────
 * A Levenshtein or trigram score needs a threshold, and any threshold either
 * admits a different person or refuses a real one, with no principled place to
 * put it. Token rules are explainable to a compliance officer and to the user:
 * "every part of the shorter name must appear in the longer one".
 */

/** Titles a bank might prepend. They carry no identity. */
const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'PROF', 'CHIEF', 'ENGR', 'REV']);

/**
 * Uppercase, strip anything that is not a letter or a space, collapse runs, and
 * drop titles. Hyphens become spaces rather than vanishing, so a
 * double-barrelled surname yields two tokens that can each be matched.
 */
export function normaliseName(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[-'’]/g, ' ')
    .replace(/[^A-Z\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TITLES.has(t));
}

/** A token matches, or a single letter matches a token starting with it. */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

export interface NameMatchResult {
  matches: boolean;
  /** How many tokens of the verified name were found. For logging, not display. */
  matched: number;
}

/**
 * Whether `accountName` plausibly names the same person as `verifiedName`.
 *
 * Three rules, in order of what they prevent:
 *
 *  1. Every token of the SHORTER name must appear in the longer one. This is
 *     what admits reordering and extra middle names while refusing a different
 *     person — "ADEBAYO SAMUEL" shares nothing with "JOSHUA OKOGHIE".
 *
 *  2. A single letter matches a token beginning with it, so "J OKOGHIE" passes.
 *
 *  3. At least TWO tokens must match when the verified name has two or more.
 *     Without this an account named only "JOSHUA" would satisfy rule 1 against
 *     "Joshua Okoghie", and a first name alone is not identification.
 */
export function namesMatch(verifiedName: string, accountName: string): NameMatchResult {
  const verified = normaliseName(verifiedName);
  const account = normaliseName(accountName);

  if (verified.length === 0 || account.length === 0) return { matches: false, matched: 0 };

  const [shorter, longer] = verified.length <= account.length
    ? [verified, account]
    : [account, verified];

  // Each token of the longer name may only be consumed once, so repetition
  // cannot manufacture matches: "JOSHUA JOSHUA" must not pass as
  // "Joshua Okoghie".
  const available = [...longer];
  let matched = 0;
  let wholeWordMatches = 0;

  for (const token of shorter) {
    const at = available.findIndex((candidate) => tokenMatches(token, candidate));
    if (at === -1) continue;
    if (available[at] === token) wholeWordMatches += 1;
    available.splice(at, 1);
    matched += 1;
  }

  // Rule 1: every token of the shorter name had to find a home.
  if (matched < shorter.length) return { matches: false, matched };

  // Rule 4: at least one match must be a whole word. Initials may SUPPLEMENT a
  // match but cannot carry it — "J O" satisfies every rule above against
  // "Joshua Okoghie" while identifying almost nobody, since it fits James Obi
  // and John Olu equally well.
  if (wholeWordMatches === 0) return { matches: false, matched };

  // Rule 3. A single-token verified name cannot reach two, so it is exempt
  // rather than permanently unsatisfiable — though signup requires both a first
  // and a last name, so it should not arise.
  const needed = verified.length >= 2 ? 2 : 1;
  return { matches: matched >= needed, matched };
}
