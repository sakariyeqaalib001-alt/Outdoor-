/** Currency is USD with 2 decimals (D-24). */
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUSD(amount: number): string {
  return usd.format(amount);
}
