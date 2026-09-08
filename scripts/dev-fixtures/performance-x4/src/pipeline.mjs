// Query pipeline. Correct, and it reads the entire source before answering anything.

export function firstBigNorthern(source) {
	const all = [...source];
	const matching = all.filter((record) => record.region === "north" && record.amountMinor > 5000);
	return matching.length > 0 ? matching[0].id : null;
}

export function topTenDoubled(source) {
	const all = [...source];
	const matching = all.filter((record) => record.amountMinor > 4000);
	const doubled = matching.map((record) => `${record.id}:${record.amountMinor * 2}`);
	return doubled.slice(0, 10);
}

export function anyOver(source, threshold) {
	const all = [...source];
	return all.filter((record) => record.amountMinor > threshold).length > 0;
}
