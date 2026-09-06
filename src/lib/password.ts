/**
 * Password strength rules, shared by every form that sets a password
 * (owner setup, and account settings) so the rules can never drift between
 * them. Mirrors the server-side check in `src/lib/auth.ts` exactly.
 */
export function validatePassword(password: string) {
  const minLength = password.length >= 10;
  const uppercase = /[A-Z]/.test(password);
  const lowercase = /[a-z]/.test(password);
  const number = /[0-9]/.test(password);
  const specialCharacter = /[^A-Za-z0-9]/.test(password);
  const isValid = minLength && uppercase && lowercase && number && specialCharacter;

  const metCount = [minLength, uppercase, lowercase, number, specialCharacter].filter(Boolean).length;

  return {
    minLength,
    uppercase,
    lowercase,
    number,
    specialCharacter,
    isValid,
    metCount,
  };
}
