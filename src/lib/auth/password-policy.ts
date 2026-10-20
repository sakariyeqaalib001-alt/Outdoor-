/**
 * Password rules for the first-login change (T-19): at least 8 characters, with at least one letter
 * and one digit. Supabase Auth must be set to the same minimum length (docs/06-operations/auth.md).
 */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordProblem = "too_short" | "needs_letter" | "needs_digit" | "mismatch";

export function checkNewPassword(password: string, confirm: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (!/[A-Za-z]/.test(password)) return "needs_letter";
  if (!/\d/.test(password)) return "needs_digit";
  if (password !== confirm) return "mismatch";
  return null;
}
