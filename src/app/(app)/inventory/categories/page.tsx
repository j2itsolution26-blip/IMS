import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Categories moved under Products; keep old bookmarks and links working.
export default function LegacyCategoriesPage() {
  redirect('/products/categories');
}
