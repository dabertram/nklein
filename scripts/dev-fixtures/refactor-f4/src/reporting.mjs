// Expense reporting: parsing, validation, aggregation, formatting and export, all in one file.

function formatMoneyMinor(amountMinor) {
	const sign = amountMinor < 0 ? "-" : "";
	const absolute = Math.abs(amountMinor);
	const major = Math.floor(absolute / 100);
	const minor = String(absolute % 100).padStart(2, "0");
	return `${sign}${major}.${minor}`;
}

export const CATEGORIES = ["travel", "meals", "hardware", "other"];

export function buildReport(text, options) {
	const opts = options ?? {};
	const rows = [];
	const rejected = [];
	const lines = String(text ?? "").split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const raw = lines[index].trim();
		if (raw === "" || raw.startsWith("#")) {
			continue;
		}
		const parts = raw.split(",").map((part) => part.trim());
		if (parts.length !== 3) {
			rejected.push({ line: index + 1, reason: "expected three fields" });
			continue;
		}
		const [category, who, amountText] = parts;
		if (!CATEGORIES.includes(category)) {
			rejected.push({ line: index + 1, reason: `unknown category ${category}` });
			continue;
		}
		if (who === "") {
			rejected.push({ line: index + 1, reason: "missing owner" });
			continue;
		}
		if (!/^-?\d+(?:\.\d{1,2})?$/u.test(amountText)) {
			rejected.push({ line: index + 1, reason: `bad amount ${amountText}` });
			continue;
		}
		const amountMinor = Math.round(Number(amountText) * 100);
		if (amountMinor < 0 && opts.allowRefunds !== true) {
			rejected.push({ line: index + 1, reason: "refunds are not allowed" });
			continue;
		}
		rows.push({ category, who, amountMinor });
	}
	const byCategory = new Map();
	for (const row of rows) {
		const current = byCategory.get(row.category) ?? { category: row.category, totalMinor: 0, count: 0, owners: [] };
		current.totalMinor += row.amountMinor;
		current.count += 1;
		if (!current.owners.includes(row.who)) {
			current.owners.push(row.who);
		}
		byCategory.set(row.category, current);
	}
	const aggregates = CATEGORIES.filter((category) => byCategory.has(category)).map((category) => {
		const entry = byCategory.get(category);
		const averageMinor = Math.round(entry.totalMinor / entry.count);
		return { ...entry, owners: [...entry.owners].sort(), averageMinor };
	});
	const width = Math.max(...CATEGORIES.map((category) => category.length));
	const tableLines = aggregates.map((entry) => {
		const major = formatMoneyMinor(entry.totalMinor);
		const padded = entry.category.padEnd(width, " ");
		return `${padded}  ${major.padStart(10, " ")}  ${String(entry.count).padStart(3, " ")}`;
	});
	const totalMinor = aggregates.reduce((sum, entry) => sum + entry.totalMinor, 0);
	const grand = formatMoneyMinor(totalMinor);
	tableLines.push(`${"TOTAL".padEnd(width, " ")}  ${grand.padStart(10, " ")}  ${String(rows.length).padStart(3, " ")}`);
	return { aggregates, rejected, table: tableLines.join("\n"), totalMinor };
}

export function exportReportCsv(report) {
	const out = ["category,total,count,owners"];
	for (const entry of report.aggregates) {
		const major = formatMoneyMinor(entry.totalMinor);
		out.push(`${entry.category},${major},${entry.count},${entry.owners.join(" ")}`);
	}
	return out.join("\n");
}
