/**
 * Phone normalization (D-03, FR-SALE-04): agents may type a Somaliland number with or without
 * +252 / 252 / a leading 0; it is stored and compared in E.164 form (+252…).
 * The list of allowed operator prefixes becomes a Super Admin setting in Phase 5.
 */
export const COUNTRY_CODE = "252";

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;

  let national: string;
  if (digits.startsWith(`+${COUNTRY_CODE}`)) national = digits.slice(COUNTRY_CODE.length + 1);
  else if (digits.startsWith("+")) return null; // other countries are not supported
  else if (digits.startsWith(`00${COUNTRY_CODE}`)) national = digits.slice(COUNTRY_CODE.length + 2);
  else if (digits.startsWith(COUNTRY_CODE) && digits.length > 9) national = digits.slice(COUNTRY_CODE.length);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;

  if (!/^[1-9]\d{6,8}$/.test(national)) return null;
  return `+${COUNTRY_CODE}${national}`;
}

/** "+252634123456" → "••••456" — for screens and messages; never show a full number unnecessarily. */
export function maskPhone(e164: string): string {
  return `••••${e164.slice(-3)}`;
}
