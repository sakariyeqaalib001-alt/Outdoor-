import { randomInt } from "node:crypto";

/**
 * One-time temporary password (FR-AUTH-04): 12 characters from an unambiguous alphabet, always with
 * letters and digits (meets T-19). Same rules as scripts/create-user.mjs (tests/unit check both).
 */
export function temporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < 12) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
