'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PropertyImageUpload } from '@/components/admin/property-image-upload';
import { propertyFormSchema, type PropertyFormValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import { formatUsd, parseDollarInput } from '@/lib/money';
import type { AdminProperty } from '@/lib/admin';

/**
 * Create and edit, one form.
 *
 * Takes DOLLARS and percent, converting to cents and basis points on submit —
 * the same reasoning as the FX form taking naira. Asking someone to hand-type
 * 45000000 for $450,000, or 920 for 9.2%, is asking for an order-of-magnitude
 * error in a listing investors will act on.
 */
export function PropertyForm({ property }: { property?: AdminProperty }) {
  const router = useRouter();
  const editing = Boolean(property);
  const moneyLocked = property ? !property.moneyEditable : false;
  const slugLocked = property ? property.status !== 'DRAFT' : false;

  const [images, setImages] = useState<string[]>(property?.images ?? []);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: property
      ? {
          slug: property.slug,
          title: property.title,
          summary: property.summary,
          description: property.description,
          addressLine: property.addressLine,
          area: property.area,
          city: property.city,
          country: property.country,
          totalValue: centsToInput(property.totalValueCents),
          minInvestment: centsToInput(property.minInvestmentCents),
          annualReturnPercent: (property.annualReturnBps / 100).toString(),
          termMonths: property.termMonths.toString(),
        }
      : { country: 'AE' },
  });

  const totalPreview = parseDollarInput(watch('totalValue') ?? '');
  const minPreview = parseDollarInput(watch('minInvestment') ?? '');

  /**
   * The annual rate is what gets stored, and it is not how anyone talks about
   * these deals — "3x over two years" is. Both boxes below edit the same
   * underlying number, so whichever one you think in, the other follows.
   *
   * This is the same trick the FX rate form uses: the admin types the unit they
   * reason in, and the conversion happens once, right here, rather than in
   * somebody's head every time.
   */
  const annualPercent = Number(watch('annualReturnPercent') ?? '');
  const months = Number(watch('termMonths') ?? '');
  const termIsUsable = Number.isFinite(months) && months > 0;
  const annualIsUsable = Number.isFinite(annualPercent) && annualPercent > 0;

  const totalReturnPercent =
    termIsUsable && annualIsUsable ? (annualPercent * months) / 12 : null;
  const multiple = totalReturnPercent === null ? null : 1 + totalReturnPercent / 100;

  function setFromTotalReturn(value: string) {
    const total = Number(value);
    if (!Number.isFinite(total) || total <= 0 || !termIsUsable) return;
    // Round to two places: the stored value is basis points, so anything finer
    // is discarded on save anyway and would make the two boxes disagree.
    const derived = Math.round(((total * 12) / months) * 100) / 100;
    setValue('annualReturnPercent', String(derived), { shouldValidate: true });
  }

  async function onSubmit(values: PropertyFormValues) {
    setFormError(null);

    const totalValueCents = parseDollarInput(values.totalValue);
    const minInvestmentCents = parseDollarInput(values.minInvestment);
    if (totalValueCents === null || minInvestmentCents === null) {
      setError('totalValue', { message: 'Enter an amount, e.g. 450000' });
      return;
    }

    // Percent to basis points. Math.round, not floor: 9.2 in floating point is
    // 9.199999999999999, and flooring that would advertise 9.19%.
    const annualReturnBps = Math.round(Number(values.annualReturnPercent) * 100);

    const payload: Record<string, unknown> = {
      slug: values.slug,
      title: values.title,
      summary: values.summary,
      description: values.description,
      addressLine: values.addressLine,
      area: values.area,
      city: values.city,
      country: values.country.toUpperCase(),
      images,
    };

    // Money fields are omitted entirely when locked. The API rejects them
    // outright on a funded property, so sending values it will refuse would
    // fail a save that is otherwise perfectly valid.
    if (!moneyLocked) {
      payload.totalValueCents = totalValueCents.toString();
      payload.minInvestmentCents = minInvestmentCents.toString();
      payload.annualReturnBps = annualReturnBps;
      payload.termMonths = Number(values.termMonths);
    }
    if (slugLocked) delete payload.slug;

    try {
      if (editing) {
        await apiFetch(`/admin/properties/${property!.id}`, {
          method: 'PATCH',
          body: payload,
        });
        router.refresh();
      } else {
        const created = await apiFetch<{ property: AdminProperty }>('/admin/properties', {
          method: 'POST',
          body: payload,
        });
        router.push(`/admin/properties/${created.property.id}`);
        return;
      }
      router.push('/admin/properties');
    } catch (err) {
      // The API returns per-field messages for slug collisions, locked fields
      // and money that does not add up. Map them back onto the inputs.
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          const target = API_FIELD_TO_FORM[field];
          if (target) setError(target, { message });
        }
        setFormError(err.message);
        return;
      }
      setFormError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      <Section title="The listing">
        <Field label="Title" error={errors.title?.message}>
          <Input placeholder="Marina Tower Residence" {...register('title')} />
        </Field>

        <Field
          label="Address in the URL"
          error={errors.slug?.message}
          hint={
            slugLocked
              ? 'Locked — investors already have this link.'
              : 'Lowercase, hyphenated. e.g. dubai-marina-tower-unit'
          }
        >
          <Input disabled={slugLocked} placeholder="dubai-marina-tower-unit" {...register('slug')} />
        </Field>

        <Field
          label="Summary"
          error={errors.summary?.message}
          hint="One line, shown on the browse grid."
        >
          <Input
            placeholder="1-bedroom high-floor unit overlooking Dubai Marina."
            {...register('summary')}
          />
        </Field>

        <Field label="Description" error={errors.description?.message}>
          <textarea
            rows={6}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-[0.875rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            placeholder="What the property is, where it sits, and why it is worth holding."
            {...register('description')}
          />
        </Field>
      </Section>

      <Section title="Where it is">
        <Field label="Address" error={errors.addressLine?.message}>
          <Input placeholder="Al Marsa Street" {...register('addressLine')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Area" error={errors.area?.message}>
            <Input placeholder="Dubai Marina" {...register('area')} />
          </Field>
          <Field label="City" error={errors.city?.message}>
            <Input placeholder="Dubai" {...register('city')} />
          </Field>
          <Field label="Country" error={errors.country?.message}>
            <Input placeholder="AE" maxLength={2} {...register('country')} />
          </Field>
        </div>
      </Section>

      <Section title="The terms">
        {moneyLocked ? (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-hairline bg-canvas px-3.5 py-3">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                {property!.investorCount} investor
                {property!.investorCount === 1 ? '' : 's'} already hold this property.
              </span>{' '}
              Value, minimum, return and term are locked. Existing holdings keep the terms
              they were sold on regardless, but changing what is advertised now would
              misstate what those investors bought.
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Property value"
            error={errors.totalValue?.message}
            hint={totalPreview !== null ? formatUsd(totalPreview) : 'In dollars, e.g. 450000'}
          >
            <Input disabled={moneyLocked} inputMode="decimal" placeholder="450000" {...register('totalValue')} />
          </Field>
          <Field
            label="Minimum investment"
            error={errors.minInvestment?.message}
            hint={minPreview !== null ? formatUsd(minPreview) : 'In dollars, e.g. 250'}
          >
            <Input disabled={moneyLocked} inputMode="decimal" placeholder="250" {...register('minInvestment')} />
          </Field>
          <Field
            label="Annual return"
            error={errors.annualReturnPercent?.message}
            hint={
              totalReturnPercent !== null
                ? `${totalReturnPercent.toFixed(1)}% over the full term`
                : 'A percentage per year, e.g. 9.2'
            }
          >
            <Input disabled={moneyLocked} inputMode="decimal" placeholder="9.2" {...register('annualReturnPercent')} />
          </Field>
          <Field label="Term" error={errors.termMonths?.message} hint="Whole months, e.g. 24">
            <Input disabled={moneyLocked} inputMode="numeric" placeholder="24" {...register('termMonths')} />
          </Field>
          <Field
            label="Total return at maturity"
            hint={
              multiple !== null
                ? `Investors get back ${multiple.toFixed(2)}× their money`
                : 'Set a term first — the total depends on it'
            }
          >
            <Input
              disabled={moneyLocked || !termIsUsable}
              inputMode="decimal"
              placeholder="200"
              value={totalReturnPercent === null ? '' : totalReturnPercent.toFixed(2)}
              onChange={(e) => setFromTotalReturn(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Photographs">
        <PropertyImageUpload images={images} onChange={setImages} />
      </Section>

      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.75rem] text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting} className="h-10">
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create as draft'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-10"
          onClick={() => router.push('/admin/properties')}
        >
          Cancel
        </Button>
      </div>

      {!editing ? (
        <p className="text-[0.75rem] text-muted-foreground">
          Saved as a draft. Nothing is visible to investors until you publish it.
        </p>
      ) : null}
    </form>
  );
}

/** API field names back onto form field names, where the two differ. */
const API_FIELD_TO_FORM: Record<string, keyof PropertyFormValues> = {
  slug: 'slug',
  title: 'title',
  summary: 'summary',
  description: 'description',
  addressLine: 'addressLine',
  area: 'area',
  city: 'city',
  country: 'country',
  totalValueCents: 'totalValue',
  minInvestmentCents: 'minInvestment',
  annualReturnBps: 'annualReturnPercent',
  termMonths: 'termMonths',
};

/** Cents string to what a person would type: 45000000 -> "450000". */
function centsToInput(cents: string): string {
  const n = Number(cents) / 100;
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
      <h2 className="mb-4 text-[0.9375rem] font-semibold text-foreground">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[0.8125rem] font-medium text-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p role="alert" className="mt-1 text-[0.75rem] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[0.75rem] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
