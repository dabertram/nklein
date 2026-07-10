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
/** A dev-test selection: a preset name (curated shortcuts) or any dev-test-projects registry id. */
export type DevTestSelection = NKleinDevTestProjectPreset | (string & {});

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

// The dev-test scenario definitions live as folders under the repo-root `dev-test-projects/` registry (each is
// `project.json` + `specification.md` + `user-prompt.txt`); see `dev-test-project-registry.ts`. They are loaded
// LAZILY and memoized on first use — NEVER at module-init — so merely importing this module (which the CLI does via
// `nklein dev` and the projects API) performs no disk I/O and cannot crash when the registry is absent (e.g. the
// published npm package, which does not ship `dev-test-projects/`). Accessors are the stable API the runner/UI/tests
// consume; each resolves to the same registry-sourced `prompt`/`specification`/`complexity`/`templateName` values.

/** The registry id backing each preset. §5.O DAG-shape presets (wide_fanout … many_small) stress parallel fan-out. */
const DEV_TEST_SCENARIO_ID_BY_PRESET: Record<NKleinDevTestProjectPreset, string> = {
	mid_task: "habit-insights-mid",
	complex_dag: "habit-product-nklein-complex",
	audio_vst: "audio-vst-psytrance",
	daw_foundation: "daw-foundation-platform",
	wide_fanout: "habit-wide-fanout",
	deep_chain: "habit-deep-chain",
	mixed_dag: "habit-mixed-dag",
	many_small: "habit-many-small",
};
const DEFAULT_DEV_TEST_SCENARIO_ID = "small-model-smoke";

const devTestScenarioCache = new Map<string, NKleinDevTestProjectScenario>();

/** Load a dev-test scenario by registry id, memoized so each is read from disk at most once (never at import). */
function loadDevTestScenarioCached(id: string): NKleinDevTestProjectScenario {
	const cached = devTestScenarioCache.get(id);
	if (cached) {
		return cached;
	}
	const scenario = loadDevTestProjectScenario(id);
	devTestScenarioCache.set(id, scenario);
	return scenario;
}

/** The default dev-test scenario (`small-model-smoke`), loaded lazily on first call — never at module import. */
export function getDefaultNKleinDevTestScenario(): NKleinDevTestProjectScenario {
	return loadDevTestScenarioCached(DEFAULT_DEV_TEST_SCENARIO_ID);
}

export function resolveNKleinDevTestProjectScenario(
	preset: DevTestSelection = "mid_task",
): NKleinDevTestProjectScenario {
	// A selection is either one of the 8 preset names or a registry folder id (e.g. "01_clinical_medication_safety_platform")
	// — the lower-20 scenario sets are driven by id, not by hand-adding a preset per project (todo §13f).
	const registryId = DEV_TEST_SCENARIO_ID_BY_PRESET[preset as NKleinDevTestProjectPreset] ?? preset;
	return loadDevTestScenarioCached(registryId);
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

function getDevTestFixtureToolchainRules(templateName: string): string[] {
	if (templateName !== DEFAULT_TEMPLATE_NAME) {
		return [];
	}
	return [
		"## Fixture/toolchain rules",
		"",
		"- Product source files are TypeScript under `src/**/*.ts`.",
		"- Test files may be plain JavaScript (`test/**/*.test.js`) or TypeScript (`test/**/*.test.ts`).",
		"- A `.test.js` file must stay plain JavaScript: no `import type`, `interface`, `type`, `: Type`, `as Type`, or generic syntax. If a test needs TypeScript syntax, name it `.test.ts`.",
		"- Tests import product code from `../src/*.ts` and must pass through `npm test` with no network or new dependencies.",
		"",
	];
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
	const scenario = options.scenario ?? getDefaultNKleinDevTestScenario();
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
	const templateName = options.templateName ?? scenario.templateName ?? DEFAULT_TEMPLATE_NAME;
	const templatePath = resolveNKleinDevTestTemplatePath(templateName);
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
			...getDevTestFixtureToolchainRules(templateName),
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
