import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { PropertyForm } from '@/components/admin/property-form';
import { PropertyStatusActions } from '@/components/admin/property-status-actions';
import { getAdminProperty } from '@/lib/admin';

export const metadata: Metadata = { title: 'Edit listing · Admin' };

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const property = await getAdminProperty(id);
  if (!property) notFound();

  return (
    <div>
      <Link
        href="/admin/properties"
        className="mb-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Properties
      </Link>

      <PageHeader title={property.title} description={`/properties/${property.slug}`} />

      <div className="mb-6">
        <PropertyStatusActions property={property} />
      </div>

      <PropertyForm property={property} />
    </div>
  );
}
