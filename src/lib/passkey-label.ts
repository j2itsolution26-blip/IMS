/**
 * A default name for a new passkey, from the browser that created it, so the
 * profile can list "iPhone" and "Windows" rather than two identical rows.
 * The user can rename it; nothing depends on the value.
 */
export function passkeyLabelFromUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  // iPadOS 13+ reports itself as a Mac; the touch hint is not in the header,
  // so an iPad usually reads as "Mac" here — still a fair label.
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Passkey';
}
