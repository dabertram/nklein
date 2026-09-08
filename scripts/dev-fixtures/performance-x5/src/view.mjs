// A report view over changing rows. Correct, and it rebuilds the whole answer for every question asked.

export function runScript(dataset, folder, steps) {
	const updates = [];
	const answers = [];

	function currentRows() {
		const byId = new Map();
		for (let index = 0; index < dataset.size; index += 1) {
			const row = dataset.at(index);
			byId.set(row.id, row);
		}
		for (const row of updates) {
			byId.set(row.id, { ...row });
		}
		return [...byId.values()];
	}

	function totals() {
		const sums = new Map();
		for (const row of currentRows()) {
			sums.set(row.team, folder.add(sums.get(row.team) ?? 0, row.amountMinor));
		}
		return [...sums.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([team, totalMinor]) => ({ team, totalMinor }));
	}

	for (const step of steps) {
		if (step.kind === "update") {
			updates.push({ ...step.row });
		} else if (step.kind === "totals") {
			answers.push(totals());
		} else {
			const ranked = [...totals()].sort(
				(left, right) => right.totalMinor - left.totalMinor || left.team.localeCompare(right.team),
			);
			answers.push(ranked[0]?.team ?? null);
		}
	}
	return answers;
}
