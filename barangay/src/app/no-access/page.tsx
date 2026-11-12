import Link from 'next/link';

export const metadata = { title: 'No access' };

export default function NoAccess() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-sm text-slate-500">Ask the Punong Barangay if your role should include it.</p>
      <Link href="/" className="btn-secondary">
        Back to dashboard
      </Link>
    </main>
  );
}
