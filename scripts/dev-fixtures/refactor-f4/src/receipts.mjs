// Receipt rendering. The minor-to-major money formatting was copied out of reporting.mjs.

function formatMoneyMinor(amountMinor) {
	const sign = amountMinor < 0 ? "-" : "";
	const absolute = Math.abs(amountMinor);
	const major = Math.floor(absolute / 100);
	const minor = String(absolute % 100).padStart(2, "0");
	return `${sign}${major}.${minor}`;
}

export function renderReceipt(row) {
	if (!row || typeof row.category !== "string") {
		throw new TypeError("a receipt needs a category");
	}
	const major = formatMoneyMinor(row.amountMinor);
	const padded = row.category.padEnd(8, " ");
	const owner = String(row.who ?? "").padEnd(12, " ");
	const amount = major.padStart(10, " ");
	return `${padded}${owner}${amount}`;
}
