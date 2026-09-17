import { formatAed, formatUsd } from '../../lib/money';
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
  type DocumentMeta,
} from './layout';

/**
 * Proof of what somebody holds.
 *
 * Every figure here comes from the Investment row, which SNAPSHOTS the rate and
 * the term at the moment of purchase. That is what makes it safe to generate on
 * demand rather than storing a signed copy: editing the property tomorrow
 * cannot change what this certificate says, because it never reads the property
 * for anything but its name and address.
 */

export interface CertificateData {
  investmentId: string;
  investorName: string;
  investorEmail: string;
  propertyTitle: string;
  propertyArea: string;
  propertyCity: string;
  principalCents: bigint;
  projectedTotalCents: bigint;
  annualReturnBps: number;
  termMonths: number;
  investedAt: Date;
  maturesAt: Date;
  status: string;
}

/** UTC, matching how the dates are stored and what the footer stamps. */
const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export async function renderCertificate(data: CertificateData): Promise<Buffer> {
  // Short and stable: the same investment always produces the same reference,
  // so two copies of a certificate can be told to be the same document.
  const meta: DocumentMeta = {
    kind: 'Investment certificate',
    reference: `TW-CERT-${data.investmentId.slice(0, 8).toUpperCase()}`,
  };

  const doc = createDocument(meta);

  doc
    .fillColor(COLOURS.ink)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(data.propertyTitle, { width: CONTENT_WIDTH });
  doc
    .fillColor(COLOURS.subtle)
    .font('Helvetica')
    .fontSize(9.5)
    .text(`${data.propertyArea}, ${data.propertyCity}`, { width: CONTENT_WIDTH });

  heading(doc, 'Holder');
  row(doc, 'Name', data.investorName);
  row(doc, 'Account', data.investorEmail);

  heading(doc, 'Holding');
  row(doc, 'Amount invested', formatUsd(data.principalCents), { strong: true });
  // The dirham line is an exact conversion at the peg, not a second figure —
  // labelled as such here for the same reason it is labelled in the app.
  row(doc, 'At the AED/USD peg', `${formatAed(data.principalCents)} (3.6725)`);
  row(doc, 'Annual return', `${(data.annualReturnBps / 100).toFixed(2)}%`);
  row(doc, 'Term', `${data.termMonths} months`);
  row(doc, 'Invested on', longDate(data.investedAt));
  row(doc, 'Matures on', longDate(data.maturesAt));
  row(doc, 'Status', data.status === 'MATURED' ? 'Matured and paid out' : 'Active');

  heading(doc, 'At maturity');
  row(doc, 'Projected total', formatUsd(data.projectedTotalCents), { strong: true });
  row(doc, 'Of which return', formatUsd(data.projectedTotalCents - data.principalCents));

  doc.moveDown(1.2);
  rule(doc);
  doc.moveDown(0.6);

  paragraph(
    doc,
    'This certificate records a fractional interest held through Tradewave and the terms agreed at the time of purchase. Those terms are fixed for the life of this holding and are not affected by any later change to the listing. Returns are projections based on the agreed rate and are not guaranteed. This document is issued for the holder named above and is not transferable.',
  );

  footer(doc, meta, new Date());
  return render(doc);
}
