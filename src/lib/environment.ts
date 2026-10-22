/**
 * Which copy of the app this is (T-24). The training site is the same code with its own database and
 * NEXT_PUBLIC_APP_ENVIRONMENT=training (set by `npm run training:*`); it shows a banner on every page.
 * NEXT_PUBLIC_ values are fixed at build time, so each copy has its own build.
 */
export type AppEnvironment = "training" | "standard";

export function appEnvironment(value: string | undefined = process.env.NEXT_PUBLIC_APP_ENVIRONMENT): AppEnvironment {
  return value === "training" ? "training" : "standard";
}

export const isTrainingSite = () => appEnvironment() === "training";
