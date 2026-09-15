'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Star, X } from 'lucide-react';
import { API_URL, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES = 12;

/**
 * Listing photographs.
 *
 * Sends the file as the raw request body rather than multipart: the API mounts
 * express.raw on this one route, which keeps the global 100kb JSON cap intact
 * and means no multipart parser on either side.
 *
 * The FIRST image is the cover — it is what the browse grid and the marketing
 * card show — so ordering is a real decision, not decoration, and it is made
 * explicit rather than left to upload order.
 */
export function PropertyImageUpload({
  images,
  onChange,
  disabled = false,
}: {
  images: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList) {
    setError(null);
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setError(`At most ${MAX_IMAGES} photographs.`);
      return;
    }

    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, room)) {
        // Checked here as well as server-side. The server is the authority; this
        // is so someone picking a 40MB photo finds out immediately rather than
        // after a long upload that was always going to be refused.
        if (file.size > MAX_BYTES) {
          throw new Error(`${file.name} is larger than 6MB.`);
        }

        const res = await fetch(`${API_URL}/admin/uploads/property-image`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: { code: string; message: string } }
            | null;
          throw new ApiError(
            res.status,
            body?.error ?? { code: 'UNKNOWN', message: 'Upload failed.' },
          );
        }

        const { url } = (await res.json()) as { url: string };
        added.push(url);
      }
      onChange([...images, ...added]);
    } catch (err) {
      // Anything already uploaded is kept: making someone redo four successful
      // uploads because the fifth failed is needless.
      if (added.length > 0) onChange([...images, ...added]);
      setError(err instanceof Error && !(err instanceof ApiError) ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function remove(url: string) {
    onChange(images.filter((i) => i !== url));
  }

  function makeCover(url: string) {
    onChange([url, ...images.filter((i) => i !== url)]);
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="block text-[0.8125rem] font-medium text-foreground">
          Photographs
        </label>
        <span className="text-[0.75rem] text-muted-foreground">
          {images.length} of {MAX_IMAGES}
        </span>
      </div>
      <p className="mt-1 text-[0.75rem] text-muted-foreground">
        JPEG, PNG or WebP, up to 6MB each. The first is the cover investors see.
      </p>

      {images.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((url, i) => (
            <li
              key={url}
              className="group relative aspect-[16/10] overflow-hidden rounded-lg border border-hairline bg-muted"
            >
              {/* Plain img, matching components/properties/property-card.tsx:
                  these are admin thumbnails, not something to optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="size-full object-cover" />

              {i === 0 ? (
                <span className="absolute top-1.5 left-1.5 rounded-md bg-ink/75 px-1.5 py-0.5 text-[0.625rem] font-medium text-white">
                  Cover
                </span>
              ) : null}

              {!disabled ? (
                <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1">
                  {i !== 0 ? (
                    <button
                      type="button"
                      onClick={() => makeCover(url)}
                      aria-label="Make this the cover image"
                      className="rounded-md bg-ink/75 p-1.5 text-white transition-colors hover:bg-ink"
                    >
                      <Star className="size-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove(url)}
                    aria-label="Remove this image"
                    className="rounded-md bg-ink/75 p-1.5 text-white transition-colors hover:bg-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy || images.length >= MAX_IMAGES}
        className={cn(
          'mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-hairline text-[0.8125rem] font-medium text-muted-foreground transition-colors',
          'hover:border-brand-700 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <ImagePlus className="size-4" />
            Add photographs
          </>
        )}
      </button>

      {error ? (
        <p role="alert" className="mt-2 text-[0.75rem] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
