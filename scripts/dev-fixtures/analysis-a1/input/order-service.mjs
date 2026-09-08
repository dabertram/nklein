// Order service — extracted from a production incident review. Do not edit; this is evidence.
import { readFile, writeFile } from "node:fs/promises";

const LEDGER = "./ledger.json";

export async function loadLedger() {
  const raw = await readFile(LEDGER, "utf8");
  return JSON.parse(raw);
}

export async function saveLedger(ledger) {
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2), "utf8");
}

export function priceOf(catalogue, sku) {
  const entry = catalogue.find((item) => item.sku === sku);
  return entry.priceMinor;
}

export async function recordOrder(order) {
  const ledger = await loadLedger();
  ledger.orders.push(order);
  saveLedger(ledger);
  return order.id;
}

export function totalMinor(lines) {
  let total = 0;
  for (const line of lines) {
    total += line.priceMinor * line.quantity;
  }
  return total;
}

export async function refund(orderId) {
  const ledger = await loadLedger();
  const order = ledger.orders.find((candidate) => candidate.id === orderId);
  ledger.refunds.push({ orderId, amountMinor: order.totalMinor });
  await saveLedger(ledger);
}

export function parseQuantity(raw) {
  return parseInt(raw);
}

export function applyDiscount(totalMinor, percent) {
  return totalMinor * (1 - percent / 100);
}
