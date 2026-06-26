import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { NKleinDevTestProjectScenario } from "./nklein-dev-test-project";

/**
 * Folder-based dev-test-project registry (todo §5.X-registry).
 *
 * Each dev-test project is a self-contained folder under the repo-root `dev-test-projects/<id>/`:
 *   - `project.json`       — the validated config (this module's `devTestProjectConfigSchema`).
 *   - `specification.md`   — the specification BODY the agent reads (the scaffolder frames it with the title +
 *                            an acceptance section; for a few projects `specificationPath` points at a larger
 *                            fixture spec instead, and `specification.md` holds a short pointer line).
 *   - `user-prompt.txt`    — the decomposition seed-card prompt.
 *
 * Registering a prepared project is therefore "add a folder with those three files" — no code change. The loader
 * discovers the folders, validates each config, reads the two text files, and produces the in-memory
 * `NKleinDevTestProjectScenario` objects the runner/UI already consume, so nothing downstream had to change.
 *
 * Loading is per-id and memoized: the named scenario constants read only their own small folders at import time,
 * and the full set (incl. the large enhanced specs) is read lazily on demand.
 */

export const DEV_TEST_PROJECTS_DIR_NAME = "dev-test-projects";

/** The validated `project.json` shape. Reuses the existing scenario fields; adds only registry metadata. */
export const devTestProjectConfigSchema = z
	.object({
		/** Stable scenario id; must equal the folder name (enforced by the loader). */
		id: z.string().min(1),
		/** Human-facing title; becomes the scaffolded `specification.md` H1 and the seed-card title. */
		title: z.string().min(1),
		/** Acceptance command run to verify the generated work (e.g. `npm test`). */
		acceptanceCommand: z.string().min(1),
		/** Agent that runs the seed card. Defaults to the native nklein agent. */
		agentId: z.string().min(1).optional(),
		/** Fixture-template folder under `scripts/dev-fixtures/` copied as the starting workspace, when any. */
		fixtureTemplate: z.string().min(1).optional(),
		/** Whether the seed card starts in plan mode (decomposition challenges do). Defaults true. */
		startInPlanMode: z.boolean().optional(),
		/** Free-form complexity tier label from the spec (e.g. "1/20", "36/36 master challenge"). */
		tier: z.string().min(1).optional(),
		/** Domain tags for grouping/filtering in the UI. */
		tags: z.array(z.string().min(1)).optional(),
		/** When false, the project is excluded from the listed registry. Defaults true. */
		enabled: z.boolean().optional(),
		/**
		 * Numeric difficulty estimate carried by the legacy migrated scenarios (0-100). Kept for byte-fidelity
		 * with the historical constants; new registry projects use the free-form `tier` instead.
		 */
		complexity: z.number().optional(),
		/** Repo-relative path to a larger specification file used instead of `specification.md` as the spec body. */
		specificationPath: z.string().min(1).optional(),
		/** Files the seed card is likely to touch (UI hint). */
		filesLikelyTouched: z.array(z.string().min(1)).optional(),
	})
	.strict();

export type DevTestProjectConfig = z.infer<typeof devTestProjectConfigSchema>;

/** A loaded registry project: its validated config plus the folder it came from. */
export interface DevTestProjectRegistryEntry {
	config: DevTestProjectConfig;
	directory: string;
	scenario: NKleinDevTestProjectScenario;
}

function getRepoRootFromCurrentModule(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function resolveDevTestProjectsDir(): string {
	return join(getRepoRootFromCurrentModule(), DEV_TEST_PROJECTS_DIR_NAME);
}

function resolveProjectDir(id: string): string {
	return join(resolveDevTestProjectsDir(), id);
}

class DevTestProjectRegistryError extends Error {}

function readRequiredTextFile(directory: string, fileName: string): string {
	try {
		return readFileSync(join(directory, fileName), "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DevTestProjectRegistryError(
			`dev-test project "${directory}": missing or unreadable ${fileName}: ${message}`,
		);
	}
}

/** Parse + validate a `project.json` for a known folder name, enforcing that `id` matches the folder. */
export function parseDevTestProjectConfig(rawJson: string, directoryName: string): DevTestProjectConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DevTestProjectRegistryError(
			`dev-test project "${directoryName}": project.json is not valid JSON: ${message}`,
		);
	}
	const result = devTestProjectConfigSchema.safeParse(parsed);
	if (!result.success) {
		throw new DevTestProjectRegistryError(
			`dev-test project "${directoryName}": invalid project.json: ${result.error.message}`,
		);
	}
	if (result.data.id !== directoryName) {
		throw new DevTestProjectRegistryError(
			`dev-test project "${directoryName}": project.json id "${result.data.id}" must equal the folder name.`,
		);
	}
	return result.data;
}

function buildScenarioFromConfig(config: DevTestProjectConfig, directory: string): NKleinDevTestProjectScenario {
	const specification = readRequiredTextFile(directory, "specification.md");
	const prompt = readRequiredTextFile(directory, "user-prompt.txt");
	return {
		id: config.id,
		title: config.title,
		prompt,
		specification,
		acceptanceCommand: config.acceptanceCommand,
		...(config.specificationPath ? { specificationPath: config.specificationPath } : {}),
		...(typeof config.complexity === "number" ? { complexity: config.complexity } : {}),
		...(config.filesLikelyTouched ? { filesLikelyTouched: config.filesLikelyTouched } : {}),
		...(config.fixtureTemplate ? { templateName: config.fixtureTemplate } : {}),
	};
}

const entryCache = new Map<string, DevTestProjectRegistryEntry>();

/** Load (and memoize) a single registry project by id. Throws if the folder/files are missing or invalid. */
export function loadDevTestProjectRegistryEntry(id: string): DevTestProjectRegistryEntry {
	const cached = entryCache.get(id);
	if (cached) {
		return cached;
	}
	const directory = resolveProjectDir(id);
	const config = parseDevTestProjectConfig(readRequiredTextFile(directory, "project.json"), id);
	const entry: DevTestProjectRegistryEntry = {
		config,
		directory,
		scenario: buildScenarioFromConfig(config, directory),
	};
	entryCache.set(id, entry);
	return entry;
}

/** Load (and memoize) a single registry project's scenario by id — the shape the runner/UI consume. */
export function loadDevTestProjectScenario(id: string): NKleinDevTestProjectScenario {
	return loadDevTestProjectRegistryEntry(id).scenario;
}

/** List the discoverable project ids (folders that contain a `project.json`), sorted by folder name. */
export function listDevTestProjectIds(): string[] {
	const root = resolveDevTestProjectsDir();
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return [];
	}
	const ids: string[] = [];
	for (const name of names) {
		try {
			if (statSync(join(root, name, "project.json")).isFile()) {
				ids.push(name);
			}
		} catch {
			// Not a project folder (no project.json, or not a directory) — skip silently.
		}
	}
	return ids.sort((left, right) => left.localeCompare(right));
}

/**
 * Load every enabled registry project. A project whose folder is malformed is skipped with a diagnostic so one
 * broken folder cannot break listing the rest (matching the JSONL store's skip-and-warn philosophy).
 */
export function loadDevTestProjectRegistry(): DevTestProjectRegistryEntry[] {
	const entries: DevTestProjectRegistryEntry[] = [];
	for (const id of listDevTestProjectIds()) {
		try {
			const entry = loadDevTestProjectRegistryEntry(id);
			if (entry.config.enabled === false) {
				continue;
			}
			entries.push(entry);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`[dev-test-project-registry] skipping "${id}": ${message}\n`);
		}
	}
	return entries;
}

/** Test-only: drop the memoized entries so a freshly-written folder is re-read. */
export function clearDevTestProjectRegistryCache(): void {
	entryCache.clear();
}
