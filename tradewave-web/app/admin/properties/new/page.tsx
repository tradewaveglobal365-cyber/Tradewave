import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { PropertyForm } from '@/components/admin/property-form';

export const metadata: Metadata = { title: 'New listing · Admin' };

export default function NewPropertyPage() {
  return (
    <div>
      <Link
        href="/admin/properties"
        className="mb-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Properties
      </Link>

      <PageHeader
        title="New listing"
        description="Saved as a draft. Nothing reaches investors until you publish it."
      />

      <PropertyForm />
    </div>
  );
}
