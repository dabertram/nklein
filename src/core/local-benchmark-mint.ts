import { generateLineMutants, type LineMutant } from "./mutation-adequacy";

export const PINNED_SWE_SMITH_COMMIT = "9b74ac08118a85c39c356802f7961893af73e07f";
export const LOCAL_BENCHMARK_PUBLIC_ACCEPTANCE = "git diff --check";

export interface LocalBenchmarkMutationCandidate extends LineMutant {
	file: string;
}

function validateRelativeFile(file: string): string {
	const normalized = file.trim().replaceAll("\\", "/");
	if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
		throw new Error(`Local benchmark file must be a safe repository-relative path: ${file}`);
	}
	return normalized;
}

export function planLocalBenchmarkMutations(input: {
	files: readonly { path: string; source: string }[];
	testFiles: readonly string[];
	maxMutants?: number;
}): readonly LocalBenchmarkMutationCandidate[] {
	const maxMutants = input.maxMutants ?? 12;
	if (!Number.isInteger(maxMutants) || maxMutants <= 0 || maxMutants > 100) {
		throw new Error("Local benchmark maxMutants must be an integer between 1 and 100.");
	}
	const protectedTests = new Set(input.testFiles.map(validateRelativeFile));
	const paths = new Set<string>();
	const candidates: LocalBenchmarkMutationCandidate[] = [];
	for (const entry of [...input.files].sort((left, right) => left.path.localeCompare(right.path))) {
		const file = validateRelativeFile(entry.path);
		if (paths.has(file)) throw new Error(`Duplicate local benchmark implementation file ${file}.`);
		if (protectedTests.has(file)) throw new Error(`Refusing to mutate protected test file ${file}.`);
		paths.add(file);
		const lineCount = entry.source.split("\n").length;
		const changedLines = Array.from({ length: lineCount }, (_, index) => index + 1);
		for (const mutant of generateLineMutants(entry.source, changedLines)) candidates.push({ file, ...mutant });
	}
	return candidates
		.sort(
			(left, right) =>
				left.file.localeCompare(right.file) ||
				left.line - right.line ||
				left.operator.localeCompare(right.operator),
		)
		.slice(0, maxMutants);
}

export function localBenchmarkProblemStatement(file: string): string {
	const safeFile = validateRelativeFile(file);
	return [
		`A regression was introduced in ${safeFile}.`,
		"Existing behavior covered by the repository's test suite is now broken.",
		"Restore the intended behavior without weakening, deleting, or bypassing tests.",
	].join(" ");
}

/** Carry a runnable public contract without exposing any held-out file, command, or oracle identifier. */
export function buildLocalBenchmarkExecutionPrompt(problemStatement: string): string {
	return `${problemStatement.trim()}\n\nAcceptance check: ${LOCAL_BENCHMARK_PUBLIC_ACCEPTANCE}`;
}
