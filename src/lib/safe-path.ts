/**
 * Whether `path` is safe to redirect to after sign-in or unlock: a path on this
 * site only. `//evil.example` and `/\evil` are protocol-relative URLs that
 * browsers resolve to another host, so a bare `startsWith('/')` is not enough.
 */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}
