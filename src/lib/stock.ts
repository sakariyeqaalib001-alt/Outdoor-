/** "2 × WiFi Router, 1 × PDCOM" — used by server and client stock screens. */
export function linesText(lines: { item_id: string; quantity: number }[], itemName: Record<string, string>): string {
  return lines.map((l) => `${l.quantity} × ${itemName[l.item_id] ?? "?"}`).join(", ");
}
