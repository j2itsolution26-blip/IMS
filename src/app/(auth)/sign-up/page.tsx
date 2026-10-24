import { redirect } from 'next/navigation';

/**
 * Public sign-up no longer exists: the first account is created through
 * first-time setup, and every later one by an administrator. The old address
 * goes to setup, which itself sends people to sign-in once setup is done.
 */
export default function SignUpPage() {
  redirect('/setup');
}
