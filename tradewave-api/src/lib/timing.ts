/**
 * Pads an operation to a fixed minimum duration.
 *
 * Endpoints that must not reveal whether an account exists (forgot-password,
 * resend-verification) do measurably more work on the "real account" branch:
 * they write a token row and dispatch an email. Returning as soon as that work
 * finishes leaks the answer through response latency even when the response
 * body is identical.
 *
 * Padding to a floor above the slowest branch makes both paths indistinguishable.
 * It cannot pad *down*, so the floor must exceed real worst-case work.
 */
export async function withMinimumDuration<T>(floorMs: number, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await work();
  } finally {
    const remaining = floorMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
