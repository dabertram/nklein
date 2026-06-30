import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isPathInsideGitWorkTree, resolveSafeCreatedWorkspaceParentDir } from "../config/workspace-location";
import type { RuntimeDevTestProjectPreset } from "../core/projects-api-contract";
import { toSlug } from "../core/slugify";
import { loadDevTestProjectScenario } from "./dev-test-project-registry";

const execFileAsync = promisify(execFile);
const DEFAULT_TEMPLATE_NAME = "smoke-ts-cli";
export const NKLEIN_DEV_TEST_PROJECT_MARKER_PATH = join(".nklein", "nklein", "dev-test-project.json");

export interface NKleinDevTestProjectScenario {
	id: string;
	title: string;
	prompt: string;
	specification: string;
	specificationPath?: string;
	acceptanceCommand: string;
	complexity?: number;
	filesLikelyTouched?: string[];
	templateName?: string;
}

export type NKleinDevTestProjectPreset =
	| "mid_task"
	| "complex_dag"
	| "audio_vst"
	| "daw_foundation"
	| "wide_fanout"
	| "deep_chain"
	| "mixed_dag"
	| "many_small";

// Compile-time drift guard: the runtime API's preset enum (the `node:*`-free contract) MUST stay in lock-step with the
// list above (its implementation lives here). Either assignment fails to compile if the two diverge — so a new preset
// added in one place can't silently become un-scoutable through the API (todo §5.AF scout, 2026-06-28).
const _devTestPresetContractGuard: NKleinDevTestProjectPreset = "mid_task" as RuntimeDevTestProjectPreset;
const _devTestPresetModuleGuard: RuntimeDevTestProjectPreset = "mid_task" as NKleinDevTestProjectPreset;
void _devTestPresetContractGuard;
void _devTestPresetModuleGuard;

export interface ScaffoldNKleinDevTestProjectOptions {
	scenario?: NKleinDevTestProjectScenario;
	/**
	 * Requested parent directory for the created workspace. Honored ONLY if it is not at/below !Klein's parent
	 * folder; an unsafe request is redirected to a safe base (see resolveSafeCreatedWorkspaceParentDir). Omit to use
	 * the configured/home-default safe base.
	 */
	parentDir?: string;
	/** User-configured safe base dir (global setting) for created workspaces; overridden by a safe `parentDir`. */
	workspaceBaseDir?: string;
	templateName?: string;
	initializeGit?: boolean;
	now?: () => number;
}

export interface ScaffoldedNKleinDevTestProject {
	workspacePath: string;
	templatePath: string;
	scenario: NKleinDevTestProjectScenario;
	acceptanceCommand: string;
	gitInitialized: boolean;
	/** Non-null when an unsafe requested/configured parent dir was redirected to a safe base (reason for logging). */
	parentDirSafetyRedirect: string | null;
}

export interface NKleinDevTestProjectMarker {
	createdBy: "nklein-dev-test";
	scenarioId: string;
	scenarioTitle: string;
	createdAt: number;
}

// The dev-test scenario definitions now live as folders under the repo-root `dev-test-projects/` registry
// (each is `project.json` + `specification.md` + `user-prompt.txt`); see `dev-test-project-registry.ts`. These
// named constants are the stable public API the runner/UI/tests consume — they are sourced from their registry
// folder by id, so the exact `prompt`/`specification`/`complexity`/`templateName` values are unchanged.

export const DEFAULT_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("small-model-smoke");

export const MID_COMPLEXITY_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("habit-insights-mid");

export const COMPLEX_DAG_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("habit-product-nklein-complex");

export const AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("audio-vst-psytrance");

export const DAW_FOUNDATION_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("daw-foundation-platform");

// §5.O parallel-fan-out dev-test projects: DAG-shape stress presets that exercise + benefit from parallel
// multi-agent execution (the swarm executor, sandbox pool, result-branch merges, review/delivery). They reuse
// the small TS CLI template and steer the decomposition toward a specific shape via the prompt.

export const WIDE_FANOUT_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("habit-wide-fanout");

export const DEEP_CHAIN_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("habit-deep-chain");

export const MIXED_DAG_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("habit-mixed-dag");

export const MANY_SMALL_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario =
	loadDevTestProjectScenario("habit-many-small");

export function resolveNKleinDevTestProjectScenario(
	preset: NKleinDevTestProjectPreset = "mid_task",
): NKleinDevTestProjectScenario {
	if (preset === "complex_dag") {
		return COMPLEX_DAG_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "audio_vst") {
		return AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "daw_foundation") {
		return DAW_FOUNDATION_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "wide_fanout") {
		return WIDE_FANOUT_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "deep_chain") {
		return DEEP_CHAIN_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "mixed_dag") {
		return MIXED_DAG_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "many_small") {
		return MANY_SMALL_NKLEIN_DEV_TEST_SCENARIO;
	}
	return MID_COMPLEXITY_NKLEIN_DEV_TEST_SCENARIO;
}

function getRepoRootFromCurrentModule(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function slugify(input: string): string {
	return toSlug(input) || "dev-test";
}

export function resolveNKleinDevTestTemplatePath(templateName = DEFAULT_TEMPLATE_NAME): string {
	return join(getRepoRootFromCurrentModule(), "scripts", "dev-fixtures", templateName);
}

async function initializeGitRepository(workspacePath: string): Promise<void> {
	// HARD BACKSTOP against the dev-test pollution incident: never `git init`/commit inside an existing git work tree
	// (the !Klein repo or one of its `.claude/worktrees/*` checkouts). The resolver should already keep us out, but a
	// `git init` here would otherwise seed fixture commits + flip `core.bare` on the shared repo. Fail loudly instead.
	if (isPathInsideGitWorkTree(workspacePath)) {
		throw new Error(
			`Refusing to initialize a git repo at "${workspacePath}": it is inside an existing git work tree. ` +
				"Created workspaces must live outside any repo (see resolveSafeCreatedWorkspaceParentDir).",
		);
	}
	await execFileAsync("git", ["init"], { cwd: workspacePath });
	await execFileAsync("git", ["config", "kanban.repositoryCreatedByKanban", "true"], { cwd: workspacePath });
	await execFileAsync("git", ["add", "."], { cwd: workspacePath });
	await execFileAsync("git", ["commit", "-m", "Initial dev test fixture"], {
		cwd: workspacePath,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "!Klein Dev Test",
			GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "kanban-dev-test@example.invalid",
			GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "!Klein Dev Test",
			GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "kanban-dev-test@example.invalid",
		},
	});
}

export async function scaffoldNKleinDevTestProject(
	options: ScaffoldNKleinDevTestProjectOptions = {},
): Promise<ScaffoldedNKleinDevTestProject> {
	const scenario = options.scenario ?? DEFAULT_NKLEIN_DEV_TEST_SCENARIO;
	// SAFETY (isolation invariant): a created workspace must never live at/below !Klein's parent folder, or its
	// git init/commit pollutes the dev repo + sibling worktrees. Honor a safe requested/configured path, else fall
	// back to the home-default safe base (and ensure it exists, since it may not on first use).
	const safeParent = resolveSafeCreatedWorkspaceParentDir({
		requestedParentDir: options.parentDir ?? null,
		configuredBaseDir: options.workspaceBaseDir ?? null,
	});
	const parentDir = safeParent.parentDir;
	await mkdir(parentDir, { recursive: true });
	const now = options.now ?? Date.now;
	const createdAt = now();
	const workspacePath = await mkdtemp(join(parentDir, `nklein-${slugify(scenario.id)}-${createdAt}-`));
	const templatePath = resolveNKleinDevTestTemplatePath(options.templateName ?? scenario.templateName);
	const specification = scenario.specificationPath
		? await readFile(join(getRepoRootFromCurrentModule(), scenario.specificationPath), "utf8")
		: scenario.specification;
	await cp(templatePath, workspacePath, {
		recursive: true,
		errorOnExist: false,
		force: true,
	});
	await writeFile(
		join(workspacePath, "specification.md"),
		[
			`# ${scenario.title}`,
			"",
			specification.trim(),
			"",
			"## Acceptance",
			"",
			`Run \`${scenario.acceptanceCommand}\` successfully.`,
			"",
		].join("\n"),
		"utf8",
	);
	const marker: NKleinDevTestProjectMarker = {
		createdBy: "nklein-dev-test",
		scenarioId: scenario.id,
		scenarioTitle: scenario.title,
		createdAt,
	};
	const markerPath = join(workspacePath, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH);
	await mkdir(dirname(markerPath), { recursive: true });
	await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
	const shouldInitializeGit = options.initializeGit ?? true;
	if (shouldInitializeGit) {
		await initializeGitRepository(workspacePath);
	}
	return {
		workspacePath,
		templatePath,
		scenario,
		acceptanceCommand: scenario.acceptanceCommand,
		gitInitialized: shouldInitializeGit,
		parentDirSafetyRedirect: safeParent.redirected ? safeParent.reason : null,
	};
}
