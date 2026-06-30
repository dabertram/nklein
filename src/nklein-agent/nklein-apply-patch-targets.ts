// Pure parser for the apply_patch tool's patch text into per-file targets (extracted from
// nklein-runtime-setup.ts, §5.U). The tool-approval policy uses this to learn which paths a patch
// touches and how many lines it adds, without applying anything. Recognizes the
// `*** Add|Update|Delete File: <path>` headers and tallies added/removed lines per hunk; malformed or
// empty input yields an empty target list (the approval layer then has nothing to gate).

export type ApplyPatchTarget =
	| { type: "add"; path: string; addedLines: number; addedText: string }
	| { type: "update"; path: string; delta: number; addedText: string }
	| { type: "delete"; path: string };

function appendPatchAddedLine(existing: string, line: string): string {
	return existing ? `${existing}\n${line}` : line;
}

export function parseApplyPatchTargets(input: unknown): ApplyPatchTarget[] {
	const rawPatch =
		typeof input === "string"
			? input
			: input && typeof input === "object" && typeof (input as Record<string, unknown>).input === "string"
				? ((input as Record<string, unknown>).input as string)
				: "";
	if (!rawPatch.trim()) {
		return [];
	}

	const lines = rawPatch.split("\n");
	const targets: ApplyPatchTarget[] = [];
	let current: ApplyPatchTarget | null = null;

	const flushCurrent = (): void => {
		if (current) {
			targets.push(current);
			current = null;
		}
	};

	for (const line of lines) {
		const headerMatch = line.match(/^\*\*\*\s+(Add|Update|Delete)\s+File:\s+(.+)$/);
		if (headerMatch) {
			flushCurrent();
			const action = headerMatch[1];
			const path = headerMatch[2]?.trim() ?? "";
			if (!path) {
				continue;
			}
			if (action === "Add") {
				current = { type: "add", path, addedLines: 0, addedText: "" };
			} else if (action === "Update") {
				current = { type: "update", path, delta: 0, addedText: "" };
			} else {
				current = { type: "delete", path };
			}
			continue;
		}
		if (!current) {
			continue;
		}
		if (line.startsWith("***")) {
			continue;
		}
		if (current.type === "add") {
			if (line.startsWith("+")) {
				current.addedLines += 1;
				current.addedText = appendPatchAddedLine(current.addedText, line.slice(1));
			}
			continue;
		}
		if (current.type === "update") {
			if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
				continue;
			}
			if (line.startsWith("+")) {
				current.delta += 1;
				current.addedText = appendPatchAddedLine(current.addedText, line.slice(1));
			} else if (line.startsWith("-")) {
				current.delta -= 1;
			}
		}
	}
	flushCurrent();

	return targets;
}
