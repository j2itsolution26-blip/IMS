import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Shift history moved to Shift Management; old links and bookmarks land there with their filters. */
export default async function ShiftHistoryRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const query = params.toString();
  redirect(query ? `/shifts?${query}` : '/shifts');
}
