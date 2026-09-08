// Reporting over an instrumented dataset. Correct, and it re-reads the data far more than it needs to.

export function totalsByTeam(dataset) {
	const teams = [];
	for (let index = 0; index < dataset.size; index += 1) {
		const { team } = dataset.at(index);
		if (!teams.includes(team)) {
			teams.push(team);
		}
	}
	teams.sort((left, right) => left.localeCompare(right));
	return teams.map((team) => {
		let totalMinor = 0;
		for (let index = 0; index < dataset.size; index += 1) {
			const row = dataset.at(index);
			if (row.team === team) {
				totalMinor += row.amountMinor;
			}
		}
		return { team, totalMinor };
	});
}

export function amountsFor(dataset, ids) {
	return ids.map((id) => {
		for (let index = 0; index < dataset.size; index += 1) {
			const row = dataset.at(index);
			if (row.id === id) {
				return row.amountMinor;
			}
		}
		return null;
	});
}
