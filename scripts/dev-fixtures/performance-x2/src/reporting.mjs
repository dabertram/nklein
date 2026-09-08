// Item reporting. Correct, and it keeps asking for things it has already been told.

function distinctGroups(items) {
	const groups = [];
	for (const item of items) {
		if (!groups.includes(item.group)) {
			groups.push(item.group);
		}
	}
	return groups.sort();
}

export function convertAll(items, priceBook) {
	return items.map((item) => ({
		id: item.id,
		baseMinor: Math.round((item.amountMinor * priceBook.rateFor(item.currency)) / 100),
	}));
}

export function rankByGroup(items, scorer) {
	return distinctGroups(items).map((group) => {
		const remaining = items.filter((item) => item.group === group);
		const ranked = [];
		// A selection sort that recomputes both keys on every comparison.
		while (remaining.length > 0) {
			let bestIndex = 0;
			for (let index = 1; index < remaining.length; index += 1) {
				const candidate = scorer.scoreOf(remaining[index]);
				const best = scorer.scoreOf(remaining[bestIndex]);
				if (candidate > best || (candidate === best && remaining[index].id.localeCompare(remaining[bestIndex].id) < 0)) {
					bestIndex = index;
				}
			}
			ranked.push(remaining[bestIndex].id);
			remaining.splice(bestIndex, 1);
		}
		return { group, ranked };
	});
}

export function groupReport(items, priceBook, scorer) {
	return distinctGroups(items).map((group) => {
		const members = items.filter((item) => item.group === group);
		let totalBaseMinor = 0;
		for (const item of members) {
			totalBaseMinor += Math.round((item.amountMinor * priceBook.rateFor(item.currency)) / 100);
		}
		let top = null;
		for (const candidate of members) {
			if (top === null) {
				top = candidate;
				continue;
			}
			if (
				scorer.scoreOf(candidate) > scorer.scoreOf(top) ||
				(scorer.scoreOf(candidate) === scorer.scoreOf(top) && candidate.id.localeCompare(top.id) < 0)
			) {
				top = candidate;
			}
		}
		return { group, totalBaseMinor, top: top.id };
	});
}
