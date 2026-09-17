import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { badRequest, unauthorized } from '../../lib/errors';
import * as service from './document.service';

export const documentRouter = Router();

/**
 * Records an investor can download.
 *
 * These routes answer with a PDF rather than JSON, so they are reached by a
 * plain link rather than through apiFetch. That works because the cookie is
 * SameSite=Lax and a download is a top-level GET: the browser sends it. It also
 * means a document can be opened in a new tab and saved like any other file,
 * which is the whole point of shipping a file rather than a web page.
 */

function sendPdf(res: Response, pdf: Buffer, filename: string): void {
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      // `inline` rather than `attachment`: people want to look at a statement
      // before deciding to keep it, and every browser still offers a save
      // button on its own viewer.
      'Content-Disposition': `inline; filename="${filename}"`,
      // These carry somebody's financial position. No shared cache should hold
      // one, and a back button should not resurrect it on a shared machine.
      'Cache-Control': 'private, no-store',
    })
    .send(pdf);
}

documentRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  res.json({ documents: await service.listDocuments(req.auth.userId) });
});

documentRouter.get('/certificate/:id', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  const id = req.params.id;
  if (typeof id !== 'string' || !id) throw badRequest('An id is required.');

  const pdf = await service.buildCertificate(req.auth.userId, id);
  sendPdf(res, pdf, `tradewave-certificate-${id.slice(0, 8)}.pdf`);
});

documentRouter.get('/statement', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();

  const { from, to } = req.query as { from?: string; to?: string };
  if (!from || !to) throw badRequest('Give a from and a to date.');

  const fromDate = new Date(from);
  // Inclusive of the closing day: a statement "to 31 March" that stopped at
  // midnight would silently drop everything that happened that day.
  const toDate = new Date(to);
  toDate.setUTCHours(23, 59, 59, 999);

  const pdf = await service.buildStatement(req.auth.userId, fromDate, toDate);
  sendPdf(res, pdf, `tradewave-statement-${from}-to-${to}.pdf`);
});
