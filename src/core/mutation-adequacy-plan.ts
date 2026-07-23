import { generateLineMutants } from "./mutation-adequacy";
import { isTestFilePath } from "./test-misinterpretation-detector";

export const DEFAULT_MUTATION_ADEQUACY_MAX_MUTANTS = 12;

export interface MutationAdequacyFilePatch {
	/** Exact workspace-relative path supplied by the trusted Git changed-file list. */
	path: string;
	/** A unified=0 diff restricted to this one path. */
	patch: string;
}

export interface PlannedMutation {
	path: string;
	/** 1-indexed line in the delivered result tree. */
	line: number;
	original: string;
	mutated: string;
	operator: string;
}

export interface MutationAdequacyPlan {
	applicable: boolean;
	reason: string;
	candidates: PlannedMutation[];
	truncatedCandidates: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

/**
 * Read added result-tree lines from a one-file unified diff. Context advances the result cursor, removals do not,
 * and metadata outside a hunk is ignored. The caller supplies the authoritative path so quoted Git headers never
 * become a second path parser or traversal surface.
 */
export function parseAddedResultLines(patch: string): Array<{ line: number; content: string }> {
	const added: Array<{ line: number; content: string }> = [];
	let resultLine: number | null = null;
	for (const row of patch.split(/\r?\n/u)) {
		const header = row.match(HUNK_HEADER);
		if (header) {
			resultLine = Number.parseInt(header[1] ?? "", 10);
			continue;
		}
		if (row.startsWith("@@") || row.startsWith("diff --git ")) {
			resultLine = null;
			continue;
		}
		if (resultLine === null || row === "\\ No newline at end of file") {
			continue;
		}
		if (row.startsWith("+")) {
			added.push({ line: resultLine, content: row.slice(1) });
			resultLine += 1;
			continue;
		}
		if (row.startsWith(" ")) {
			resultLine += 1;
			continue;
		}
		if (!row.startsWith("-")) {
			// A new file header or other non-hunk metadata ends this hunk defensively.
			resultLine = null;
		}
	}
	return added;
}

function isSafeRelativePath(path: string): boolean {
	const trimmed = path.trim();
	return (
		trimmed.length > 0 &&
		!trimmed.startsWith("/") &&
		!trimmed.includes("\\") &&
		!trimmed.includes("\0") &&
		!trimmed.includes("\n") &&
		trimmed.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
	);
}

/**
 * Plan a deterministic, globally bounded mutant sample only when the delivered attempt also authored/edited tests.
 * Test files themselves are never mutated: the question is whether those tests can observe behavior changes in the
 * implementation lines delivered beside them.
 */
export function planMutationAdequacy(input: {
	changedFiles: readonly string[];
	filePatches: readonly MutationAdequacyFilePatch[];
	maxMutants?: number;
}): MutationAdequacyPlan {
	if (!input.changedFiles.some(isTestFilePath)) {
		return {
			applicable: false,
			reason: "no authored or edited test file in the delivered patch",
			candidates: [],
			truncatedCandidates: 0,
		};
	}
	const maxMutants = Math.max(1, Math.trunc(input.maxMutants ?? DEFAULT_MUTATION_ADEQUACY_MAX_MUTANTS));
	const candidateGroups: PlannedMutation[][] = [];
	const seen = new Set<string>();
	const implementationPatches = [...input.filePatches]
		.filter(({ path }) => isSafeRelativePath(path) && !isTestFilePath(path))
		.sort((left, right) => left.path.localeCompare(right.path));
	for (const { path, patch } of implementationPatches) {
		for (const added of parseAddedResultLines(patch)) {
			const lineCandidates: PlannedMutation[] = [];
			for (const mutant of generateLineMutants(added.content, [1])) {
				const candidate: PlannedMutation = {
					path,
					line: added.line,
					original: mutant.original,
					mutated: mutant.mutated,
					operator: mutant.operator,
				};
				const key = `${candidate.path}\0${candidate.line}\0${candidate.operator}\0${candidate.mutated}`;
				if (!seen.has(key)) {
					seen.add(key);
					lineCandidates.push(candidate);
				}
			}
			if (lineCandidates.length > 0) {
				candidateGroups.push(lineCandidates);
			}
		}
	}
	// Sample breadth before depth: take the first applicable operator from every changed line before taking a second
	// from any line. A dense expression with many operators must not consume the whole global budget while later files
	// and lines go untested.
	const allCandidates: PlannedMutation[] = [];
	for (let depth = 0; ; depth += 1) {
		let foundAtDepth = false;
		for (const group of candidateGroups) {
			const candidate = group[depth];
			if (candidate) {
				foundAtDepth = true;
				allCandidates.push(candidate);
			}
		}
		if (!foundAtDepth) {
			break;
		}
	}
	return {
		applicable: true,
		reason:
			allCandidates.length > 0
				? `planned ${Math.min(allCandidates.length, maxMutants)} bounded mutant(s) from changed implementation lines`
				: "tests changed, but no added implementation line supported a safe mutation operator",
		candidates: allCandidates.slice(0, maxMutants),
		truncatedCandidates: Math.max(0, allCandidates.length - maxMutants),
	};
}
