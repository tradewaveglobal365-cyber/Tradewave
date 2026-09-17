import PDFDocument from 'pdfkit';

/**
 * Shared page furniture for every Tradewave document.
 *
 * ── Why pdfkit and not a headless browser ─────────────────────────────────
 * Rendering HTML to PDF means shipping Chromium: several hundred megabytes, a
 * process to supervise, and a memory profile that does not fit a small Render
 * instance. These documents are a letterhead, some rows of figures and a
 * footer — laying that out directly costs a few dozen lines and runs in
 * milliseconds.
 *
 * ── Why the colours are duplicated here ───────────────────────────────────
 * The web app's tokens live in CSS, which a PDF cannot read. These are the same
 * values from tradewave-web/app/globals.css. If the brand changes, both move.
 */

export const COLOURS = {
  ink: '#0E1512',
  subtle: '#5C6660',
  hairline: '#E5E2DA',
  brand: '#14532D',
  gain: '#16A34A',
} as const;

const MARGIN = 48;
export const CONTENT_WIDTH = 595.28 - MARGIN * 2; // A4 width, minus margins

export type Doc = PDFKit.PDFDocument;

export interface DocumentMeta {
  /** Appears under the wordmark, e.g. "Investment certificate". */
  kind: string;
  /** The document's own reference, printed in the footer for support. */
  reference: string;
}

export function createDocument(meta: DocumentMeta): Doc {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    // Required by footer(): pdfkit can only switch back to a page it is still
    // holding, and the footer needs the total count, which is not known until
    // the content has finished flowing.
    bufferPages: true,
    info: {
      Title: `Tradewave — ${meta.kind}`,
      Author: 'Tradewave',
      Creator: 'Tradewave',
    },
  });

  header(doc, meta.kind);
  return doc;
}

function header(doc: Doc, kind: string): void {
  doc
    .fillColor(COLOURS.brand)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Tradewave', MARGIN, MARGIN);

  doc
    .fillColor(COLOURS.subtle)
    .font('Helvetica')
    .fontSize(9)
    .text('Fractional Dubai real estate', MARGIN, MARGIN + 22);

  doc
    .fillColor(COLOURS.ink)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(kind.toUpperCase(), MARGIN, MARGIN + 4, { align: 'right', width: CONTENT_WIDTH });

  rule(doc, MARGIN + 46);
  doc.y = MARGIN + 62;
}

export function rule(doc: Doc, y?: number): void {
  const at = y ?? doc.y;
  doc
    .moveTo(MARGIN, at)
    .lineTo(MARGIN + CONTENT_WIDTH, at)
    .lineWidth(0.5)
    .strokeColor(COLOURS.hairline)
    .stroke();
}

/**
 * A full-width paragraph.
 *
 * Exists because row() leaves the cursor in the right-hand column, and pdfkit
 * continues from wherever the cursor is — so a paragraph written after a table
 * of figures silently starts halfway across the page and runs off the edge.
 * Passing x explicitly every time is the fix; doing it here means nobody has to
 * remember.
 */
export function paragraph(doc: Doc, text: string, size = 7.5): void {
  doc
    .fillColor(COLOURS.subtle)
    .font('Helvetica')
    .fontSize(size)
    .text(text, MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'left', lineGap: 1.5 });
}

export function heading(doc: Doc, text: string): void {
  doc.moveDown(0.8);
  doc
    .fillColor(COLOURS.subtle)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(text.toUpperCase(), MARGIN, doc.y, { characterSpacing: 0.6 });
  doc.moveDown(0.4);
}

/** A label on the left, a value on the right, on one line. */
export function row(doc: Doc, label: string, value: string, options: { strong?: boolean } = {}): void {
  const y = doc.y;
  doc
    .fillColor(COLOURS.subtle)
    .font('Helvetica')
    .fontSize(9.5)
    .text(label, MARGIN, y, { width: CONTENT_WIDTH * 0.55 });

  doc
    .fillColor(COLOURS.ink)
    .font(options.strong ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(9.5)
    .text(value, MARGIN + CONTENT_WIDTH * 0.55, y, {
      width: CONTENT_WIDTH * 0.45,
      align: 'right',
    });

  doc.y = y + 15;
}

export interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

export function tableHeader(doc: Doc, columns: Column[]): void {
  const y = doc.y;
  let x = MARGIN;
  doc.fillColor(COLOURS.subtle).font('Helvetica-Bold').fontSize(7.5);
  for (const column of columns) {
    doc.text(column.label.toUpperCase(), x, y, {
      width: column.width,
      align: column.align ?? 'left',
    });
    x += column.width;
  }
  doc.y = y + 12;
  rule(doc);
  doc.y += 5;
}

export function tableRow(doc: Doc, columns: Column[], cells: string[], tone?: 'gain'[]): void {
  // A new page before the row rather than through it — a split line of figures
  // is how a statement becomes unreadable.
  if (doc.y > 760) {
    doc.addPage();
    doc.y = MARGIN;
    tableHeader(doc, columns);
  }

  const y = doc.y;
  let x = MARGIN;
  doc.font('Helvetica').fontSize(8.5);
  columns.forEach((column, i) => {
    doc
      .fillColor(tone?.[i] === 'gain' ? COLOURS.gain : COLOURS.ink)
      .text(cells[i] ?? '', x, y, { width: column.width, align: column.align ?? 'left' });
    x += column.width;
  });
  doc.y = y + 14;
}

/**
 * Stamps every page with the reference and a generated-at time.
 *
 * Called last, because pdfkit can only switch to a page that already exists —
 * and it writes OUTSIDE the bottom margin so it cannot collide with content
 * that flowed to the end of a page.
 */
export function footer(doc: Doc, meta: DocumentMeta, generatedAt: Date): void {
  const range = doc.bufferedPageRange();
  const stamp = generatedAt.toISOString().replace('T', ' ').slice(0, 16);

  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);

    // Writing below the bottom margin makes pdfkit helpfully add another page,
    // which is how a one-page certificate ends up two pages long with a blank
    // second sheet. Dropping the margin for the width of this one call is the
    // documented way out; it is restored immediately.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc
      .fillColor(COLOURS.subtle)
      .font('Helvetica')
      .fontSize(7)
      .text(
        `${meta.reference}  ·  generated ${stamp} UTC  ·  page ${i - range.start + 1} of ${range.count}`,
        MARGIN,
        doc.page.height - 34,
        { width: CONTENT_WIDTH, align: 'center', lineBreak: false },
      );

    doc.page.margins.bottom = bottom;
  }
}

/** Collects the stream into one buffer, because a route has to send a length. */
export function render(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
