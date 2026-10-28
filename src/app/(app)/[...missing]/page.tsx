import { notFound } from 'next/navigation';

/**
 * Any address no page matches — a stale bookmark, a mistyped link — lands
 * here, inside the signed-in shell, so the "not found" message keeps the
 * sidebar, header and account menu instead of a bare page. Every real route
 * is more specific and wins; the layout still requires a session first.
 */
export default function MissingPage(): never {
  notFound();
}
