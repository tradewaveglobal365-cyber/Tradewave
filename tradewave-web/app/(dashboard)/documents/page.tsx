import type { Metadata } from 'next';
import { Download, FileText } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { StatementDownload } from '@/components/dashboard/statement-download';
import { getDocuments } from '@/lib/documents';
import { browserApiUrl } from '@/lib/api';

export const metadata: Metadata = { title: 'Documents · Tradewave' };

/**
 * Records an investor can keep.
 *
 * The statement panel is always shown, even with no holdings: "nothing moved in
 * this period" is a legitimate thing to need on paper, and a screen that hides
 * the option until you own something answers the wrong question.
 */
export default async function DocumentsPage() {
  const documents = await getDocuments();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Documents"
        description="Investment certificates and account statements, as PDFs you can keep."
      />

      <StatementDownload />

      <section className="mt-6">
        <h2 className="mb-3 text-[1rem] font-semibold text-foreground">
          Investment certificates
        </h2>

        {documents.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title="No certificates yet"
            description="Once you hold an investment, its certificate will be here to download."
          />
        ) : (
          <ul className="overflow-hidden rounded-xl border border-hairline bg-surface">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] font-medium text-foreground">
                    {doc.title}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
                    {doc.subtitle} ·{' '}
                    {new Date(doc.date).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>

                {/* A plain link: the cookie is SameSite=Lax and this is a
                    top-level GET, so the browser sends it and the PDF opens
                    like any other file. */}
                <a
                  href={`${browserApiUrl}${doc.href}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-[0.75rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Download className="size-3.5" />
                  PDF
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 text-[0.75rem] leading-relaxed text-muted-foreground">
        Certificates show the terms agreed when you invested. Those terms are fixed for the life
        of the holding and are not affected by any later change to the listing.
      </p>
    </div>
  );
}
