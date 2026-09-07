import type { Metadata } from 'next';
import { FileText } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';

export const metadata: Metadata = { title: 'Documents · Tradewave' };

export default function DocumentsPage() {
  return (
    <div>
      <PageHeader
        title="Documents"
        description="Investment certificates, contracts and periodic statements."
      />
      <EmptyState
        icon={<FileText className="size-5" />}
        title="No documents yet"
        description="Once you hold an investment, your certificate and statements will be available here to download."
      />
    </div>
  );
}
