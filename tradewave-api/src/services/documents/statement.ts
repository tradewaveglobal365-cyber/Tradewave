import { formatUsd } from '../../lib/money';
import {
  CONTENT_WIDTH,
  COLOURS,
  createDocument,
  footer,
  heading,
  paragraph,
  render,
  row,
  rule,
  tableHeader,
  tableRow,
  type Column,
  type DocumentMeta,
} from './layout';

/**
 * Every movement of money in a period, with a running balance.
 *
 * Built from LedgerEntry, which is append-only and carries balanceAfterCents on
 * every row. So the closing balance is not recomputed here and cannot disagree
 * with the wallet — it is read off the last entry, exactly as a bank statement
 * reads off its own ledger rather than re-adding the column.
 */

export interface StatementEntry {
  createdAt: Date;
  type: string;
  description: string;
  amountCents: bigint;
  balanceAfterCents: bigint;
}

export interface StatementData {
  investorName: string;
  investorEmail: string;
  from: Date;
  to: Date;
  openingCents: bigint;
  closingCents: bigint;
  entries: StatementEntry[];
}

const COLUMNS: Column[] = [
  { label: 'Date', width: 70 },
  { label: 'Description', width: 215 },
  { label: 'Amount', width: 100, align: 'right' },
  { label: 'Balance', width: 114, align: 'right' },
];

/**
 * Dates are rendered in UTC, which is how they are stored.
 *
 * Without the explicit zone this formats in the SERVER's local time, so a
 * period ending 23:59:59 UTC on 31 August printed as "01 Sept" on a machine one
 * hour ahead — a statement whose own header disagreed with its contents. The
 * footer already stamps UTC, so the document is internally consistent.
 */
const shortDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export async function renderStatement(data: StatementData): Promise<Buffer> {
  const meta: DocumentMeta = {
    kind: 'Account statement',
    reference: `TW-STMT-${data.from.toISOString().slice(0, 10)}-${data.to.toISOString().slice(0, 10)}`,
  };

  const doc = createDocument(meta);

  doc
    .fillColor(COLOURS.ink)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(data.investorName, { width: CONTENT_WIDTH });
  doc
    .fillColor(COLOURS.subtle)
    .font('Helvetica')
    .fontSize(9.5)
    .text(data.investorEmail, { width: CONTENT_WIDTH });

  heading(doc, 'Period');
  row(doc, 'From', shortDate(data.from));
  row(doc, 'To', shortDate(data.to));
  row(doc, 'Opening balance', formatUsd(data.openingCents));
  row(doc, 'Closing balance', formatUsd(data.closingCents), { strong: true });

  heading(doc, `Transactions (${data.entries.length})`);

  if (data.entries.length === 0) {
    paragraph(doc, 'No money moved in this period.', 9);
  } else {
    tableHeader(doc, COLUMNS);
    for (const entry of data.entries) {
      const credit = entry.amountCents >= 0n;
      // A plain hyphen, not the typographic minus U+2212. pdfkit's built-in
      // Helvetica is WinAnsi-encoded and has no glyph for it, so it silently
      // rendered as a double quote — every debit on the statement read
      // `" $5,000.00`. Embedding a Unicode font to gain a nicer dash is not
      // worth it for one character.
      const amount = `${credit ? '+' : '-'}${formatUsd(
        credit ? entry.amountCents : -entry.amountCents,
      )}`;

      tableRow(
        doc,
        COLUMNS,
        [
          shortDate(entry.createdAt),
          entry.description || entry.type,
          amount,
          formatUsd(entry.balanceAfterCents),
        ],
        credit ? [undefined as never, undefined as never, 'gain', undefined as never] : undefined,
      );
    }

    rule(doc);
    doc.y += 6;
    row(doc, 'Closing balance', formatUsd(data.closingCents), { strong: true });
  }

  doc.moveDown(1.2);
  rule(doc);
  doc.moveDown(0.6);
  paragraph(
    doc,
    'This statement covers the wallet balance only. Money currently held in an active investment is not part of the balance above and appears here as a debit on the date it was invested, and as a credit when that investment matures.',
  );

  footer(doc, meta, new Date());
  return render(doc);
}
