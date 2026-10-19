import en from "../../messages/en.json";

/**
 * Minimal translation helper. All UI text lives in messages/<locale>.json so Somali can be
 * added later without code changes (D-24). A full i18n library can replace this when a
 * second locale is added (T-05).
 */
export type Messages = typeof en;

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = T extends string
  ? never
  : { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T];

export type MessageKey = Paths<Messages>;

const catalogs = { en } satisfies Record<string, Messages>;
export type Locale = keyof typeof catalogs;
export const defaultLocale: Locale = "en";

export function t(
  key: MessageKey,
  values?: Record<string, string | number>,
  locale: Locale = defaultLocale
): string {
  const text = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalogs[locale]);
  if (typeof text !== "string") return key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match
  );
}
