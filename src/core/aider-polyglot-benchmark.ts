export const PINNED_AIDER_POLYGLOT_COMMIT = "7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f";

export const AIDER_POLYGLOT_LANGUAGES = ["cpp", "go", "java", "javascript", "python", "rust"] as const;
export type AiderPolyglotLanguage = (typeof AIDER_POLYGLOT_LANGUAGES)[number];

export interface AiderPolyglotTask {
	schemaVersion: 1;
	source: "aider_polyglot";
	instanceId: string;
	corpusCommit: string;
	language: AiderPolyglotLanguage;
	exercise: string;
	prompt: string;
	solutionFiles: readonly string[];
}

export interface AiderPolyglotManifest {
	schemaVersion: 1;
	corpusCommit: string;
	tasks: readonly AiderPolyglotTask[];
}

interface ExercismConfig {
	files?: {
		solution?: unknown;
		test?: unknown;
		example?: unknown;
	};
}

function parseRelativePaths(value: unknown, field: string, allowEmpty = false): string[] {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
		throw new Error(`${field} must be ${allowEmpty ? "an" : "a non-empty"} array of relative paths.`);
	}
	const paths = value.map((entry) => {
		if (typeof entry !== "string" || entry.length === 0 || entry.startsWith("/") || entry.includes("\\")) {
			throw new Error(`${field} contains an invalid relative path.`);
		}
		const parts = entry.split("/");
		if (
			parts.some((part) => part === "" || part === "." || part === "..") ||
			entry.includes("\0") ||
			entry.includes("\n")
		) {
			throw new Error(`${field} contains an unsafe relative path.`);
		}
		return entry;
	});
	if (new Set(paths).size !== paths.length) throw new Error(`${field} contains duplicate paths.`);
	return paths;
}

function parseLanguage(value: unknown): AiderPolyglotLanguage {
	if (typeof value === "string" && (AIDER_POLYGLOT_LANGUAGES as readonly string[]).includes(value)) {
		return value as AiderPolyglotLanguage;
	}
	throw new Error(`Aider polyglot language must be one of ${AIDER_POLYGLOT_LANGUAGES.join(", ")}.`);
}

function validateCommit(value: unknown): string {
	if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
		throw new Error("Aider polyglot corpus commit must be a full 40-character lowercase Git object id.");
	}
	return value;
}

export function resolveAiderPolyglotInstanceId(language: AiderPolyglotLanguage, exercise: string): string {
	if (!/^[a-z0-9][a-z0-9-]*$/u.test(exercise)) throw new Error("Aider polyglot exercise name is unsafe.");
	return `aider-${language}-${exercise}`;
}

export function parseAiderPolyglotConfig(text: string): {
	solutionFiles: readonly string[];
	testFiles: readonly string[];
	exampleFiles: readonly string[];
} {
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(`Aider polyglot exercise config is invalid JSON: ${String(error)}`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Aider polyglot exercise config must be an object.");
	}
	const files = (value as ExercismConfig).files;
	if (!files || typeof files !== "object") throw new Error("Aider polyglot exercise config lacks files.");
	return {
		solutionFiles: parseRelativePaths(files.solution, "files.solution"),
		testFiles: parseRelativePaths(files.test, "files.test"),
		exampleFiles: parseRelativePaths(files.example ?? [], "files.example", true),
	};
}

export function buildAiderPolyglotTask(input: {
	language: string;
	exercise: string;
	corpusCommit: string;
	configText: string;
	instructionParts: readonly string[];
}): AiderPolyglotTask {
	const language = parseLanguage(input.language);
	const corpusCommit = validateCommit(input.corpusCommit);
	const files = parseAiderPolyglotConfig(input.configText);
	const instructions = input.instructionParts
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n\n");
	if (!instructions) throw new Error("Aider polyglot task has no instructions.");
	return {
		schemaVersion: 1,
		source: "aider_polyglot",
		instanceId: resolveAiderPolyglotInstanceId(language, input.exercise),
		corpusCommit,
		language,
		exercise: input.exercise,
		prompt: `${instructions}\n\nImplement the exercise in: ${files.solutionFiles.join(", ")}.`,
		solutionFiles: files.solutionFiles,
	};
}

export function parseAiderPolyglotManifest(value: unknown): AiderPolyglotManifest {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Aider polyglot manifest must be an object.");
	}
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1 || !Array.isArray(record.tasks)) {
		throw new Error("Aider polyglot manifest must use schemaVersion 1 and contain tasks.");
	}
	const corpusCommit = validateCommit(record.corpusCommit);
	const seen = new Set<string>();
	const tasks = record.tasks.map((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error("Aider polyglot manifest task must be an object.");
		}
		const task = entry as Record<string, unknown>;
		const language = parseLanguage(task.language);
		if (typeof task.exercise !== "string") throw new Error("Aider polyglot task lacks exercise.");
		const instanceId = resolveAiderPolyglotInstanceId(language, task.exercise);
		if (
			task.schemaVersion !== 1 ||
			task.source !== "aider_polyglot" ||
			task.instanceId !== instanceId ||
			task.corpusCommit !== corpusCommit ||
			typeof task.prompt !== "string" ||
			!task.prompt.trim()
		) {
			throw new Error(`Aider polyglot task ${instanceId} is inconsistent with its manifest.`);
		}
		if (seen.has(instanceId)) throw new Error(`Duplicate Aider polyglot task ${instanceId}.`);
		seen.add(instanceId);
		return {
			schemaVersion: 1 as const,
			source: "aider_polyglot" as const,
			instanceId,
			corpusCommit,
			language,
			exercise: task.exercise,
			prompt: task.prompt,
			solutionFiles: parseRelativePaths(task.solutionFiles, "task.solutionFiles"),
		};
	});
	return { schemaVersion: 1, corpusCommit, tasks };
}
