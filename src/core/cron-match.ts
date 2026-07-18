/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week, LOCAL time) for the F12.106
 * trigger scheduler. Supports star, star-slash-n steps, single values, a-b ranges (with steps), and comma
 * lists per field — the practical
 * envelope — and rejects everything else loudly at parse time. Standard cron day semantics: when BOTH
 * day-of-month and day-of-week are restricted, a date matches if EITHER matches.
 *
 * Deliberately not vendored-SDK cron: the SDK's scheduler is not re-exported from its built surface, and the
 * trigger scheduler needs only membership tests on a minute grid.
 */

export interface ParsedCronExpression {
	minutes: Set<number>;
	hours: Set<number>;
	daysOfMonth: Set<number>;
	months: Set<number>;
	daysOfWeek: Set<number>;
	/** True when the source field was `*` (needed for the dom/dow either-match rule). */
	anyDayOfMonth: boolean;
	anyDayOfWeek: boolean;
}

interface FieldSpec {
	name: string;
	min: number;
	max: number;
}

const FIELDS: FieldSpec[] = [
	{ name: "minute", min: 0, max: 59 },
	{ name: "hour", min: 0, max: 23 },
	{ name: "day-of-month", min: 1, max: 31 },
	{ name: "month", min: 1, max: 12 },
	{ name: "day-of-week", min: 0, max: 7 }, // 0 and 7 are both Sunday
];

function parseField(raw: string, spec: FieldSpec): Set<number> {
	const values = new Set<number>();
	for (const part of raw.split(",")) {
		const stepMatch = /^(.+?)\/(\d+)$/.exec(part);
		const base = stepMatch?.[1] ?? part;
		const step = stepMatch ? Number(stepMatch[2]) : 1;
		if (!Number.isInteger(step) || step < 1) {
			throw new Error(`Invalid cron step in ${spec.name} field: "${part}".`);
		}
		let start: number;
		let end: number;
		if (base === "*") {
			start = spec.min;
			end = spec.max;
		} else {
			const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(base);
			if (!rangeMatch?.[1]) {
				throw new Error(`Invalid cron ${spec.name} field: "${part}".`);
			}
			start = Number(rangeMatch[1]);
			end = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : start;
		}
		if (start < spec.min || end > spec.max || start > end) {
			throw new Error(`Cron ${spec.name} value out of range (${spec.min}–${spec.max}): "${part}".`);
		}
		for (let value = start; value <= end; value += step) {
			// Normalize Sunday: 7 → 0.
			values.add(spec.name === "day-of-week" && value === 7 ? 0 : value);
		}
	}
	return values;
}

export function parseCronExpression(expression: string): ParsedCronExpression {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new Error(`Cron expression must have 5 fields (minute hour dom month dow), got ${fields.length}.`);
	}
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
	const minuteSpec = FIELDS[0] as FieldSpec;
	const hourSpec = FIELDS[1] as FieldSpec;
	const domSpec = FIELDS[2] as FieldSpec;
	const monthSpec = FIELDS[3] as FieldSpec;
	const dowSpec = FIELDS[4] as FieldSpec;
	return {
		minutes: parseField(minute, minuteSpec),
		hours: parseField(hour, hourSpec),
		daysOfMonth: parseField(dayOfMonth, domSpec),
		months: parseField(month, monthSpec),
		daysOfWeek: parseField(dayOfWeek, dowSpec),
		anyDayOfMonth: dayOfMonth === "*",
		anyDayOfWeek: dayOfWeek === "*",
	};
}

/** Does the LOCAL-time minute containing `atMs` match the expression? */
export function cronMatchesMinute(expression: ParsedCronExpression, atMs: number): boolean {
	const date = new Date(atMs);
	if (!expression.minutes.has(date.getMinutes()) || !expression.hours.has(date.getHours())) {
		return false;
	}
	if (!expression.months.has(date.getMonth() + 1)) {
		return false;
	}
	const domMatches = expression.daysOfMonth.has(date.getDate());
	const dowMatches = expression.daysOfWeek.has(date.getDay());
	// Standard cron: both restricted → either may match; otherwise both (trivially) must.
	if (!expression.anyDayOfMonth && !expression.anyDayOfWeek) {
		return domMatches || dowMatches;
	}
	return domMatches && dowMatches;
}
