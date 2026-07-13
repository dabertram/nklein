import type { z } from "zod";
import { toSlug } from "../../core/slugify";
import { populateWorkPackageShape } from "../../core/work-package-card-shape";
import type { NKleinPlanQuestion, NKleinPlanTask, NKleinPlanTaskGraph } from "../nklein-plan-artifacts";
import { expandDecomposeProjectTasks } from "./plan-task-expansion";
import { decomposeProjectToolInputSchema } from "./plan-task-schemas";
import { deriveOpenQuestionDefaults, validatePlanQuestions } from "./plan-task-validation";

export type DecomposeProjectToolInput = {
	slug: string;
	spec: string;
	plan: string;
	summary: string | null;
	questions: NKleinPlanQuestion[];
	title: string;
	tasks: NKleinPlanTask[];
	taskGraph: NKleinPlanTaskGraph;
	defaultAcceptanceCommand?: string | null;
	minimumTaskCount: number | null;
	expansions: Record<string, NKleinPlanTask[]>;
};

export function slugifyTaskId(input: string): string {
	return toSlug(input) || "task";
}

// `title` is intentionally NOT required: small models routinely omit it while sending a perfectly good
// `slug`, and the task graph already falls back to the slug as its title. We recover it rather than reject
// (see recoverMissingDecomposeProjectTitle) — parse-and-recover, not re-prompt (AGENTS.md).
const DECOMPOSE_PROJECT_REQUIRED_FIELDS = ["slug", "spec", "plan", "tasks"] as const;

const DECOMPOSE_PROJECT_RECOVERY_HINT =
	"Call decompose_project once with: slug (short string), spec (brief markdown), plan (brief markdown), " +
	"and tasks (a JSON array of objects, each with id, title, prompt). title is optional — it defaults to the " +
	"slug when omitted. Start small — 3 to 6 top-level tasks is fine and you can expand later; keep spec and " +
	"plan to a few sentences (longer text is truncated). Do not resend an empty or partial call. " +
	"Alternatively, build the graph first with add_task/add_dependency (validated step by step) and then call " +
	"decompose_project without tasks.";

export function decomposeProjectFieldIsUsable(value: unknown): boolean {
	if (typeof value === "string") {
		return value.trim().length > 0;
	}
	return value !== undefined && value !== null;
}

/**
 * Small local models routinely emit a malformed decompose_project call — typo'd or extra keys, or
 * (after one failure) an empty `{}` — and then spiral. The SDK validates the tool's inputSchema
 * BEFORE execute() runs and answers a violation with a multi-KB raw Zod dump that such models cannot
 * recover from and that burns the context budget. The boundary schema is therefore permissive (see
 * createDecomposeProjectTool) and this is where validation actually happens: throw a SHORT, directive
 * message naming the missing fields so the model has a tractable path back.
 */
export function assertUsableDecomposeProjectInput(input: unknown): void {
	const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	const missing = DECOMPOSE_PROJECT_REQUIRED_FIELDS.filter((field) => {
		if (field === "tasks") {
			return !(Array.isArray(record.tasks) || typeof record.tasks === "string");
		}
		return !decomposeProjectFieldIsUsable(record[field]);
	});
	if (missing.length === 0) {
		return;
	}
	const lead =
		Object.keys(record).length === 0
			? "decompose_project was called with no arguments."
			: `decompose_project is missing required fields: ${missing.join(", ")}.`;
	throw new Error(`${lead} ${DECOMPOSE_PROJECT_RECOVERY_HINT}`);
}

/**
 * Small models routinely emit an otherwise-valid decompose_project call but omit `title` (they always send a
 * `slug`). Rather than reject and force a retry the model may just fail again, recover the title from the slug —
 * the task graph already uses the slug as its title fallback downstream. Parse-and-recover, not re-prompt
 * (AGENTS.md). Returns the input unchanged when a usable title is already present (or there is no slug to
 * derive from — that case is caught by assertUsableDecomposeProjectInput, which still requires slug).
 */
export function recoverMissingDecomposeProjectTitle(input: unknown): unknown {
	if (typeof input !== "object" || input === null) {
		return input;
	}
	const record = input as Record<string, unknown>;
	if (decomposeProjectFieldIsUsable(record.title)) {
		return input;
	}
	const slug = typeof record.slug === "string" ? record.slug.trim() : "";
	if (!slug) {
		return input;
	}
	return { ...record, title: slug };
}

/**
 * Parse-and-recover for tasks missing a `prompt` (live-found 2026-07-08: qwopus3.5's decompose RETRY restructured its
 * JSON and dropped every task's `prompt`, putting the work text under `description` — the schema bounce then failed
 * the whole decompose). Derive the prompt from the task's own words: `description` → `details` → `title`. A task with
 * none of those stays untouched, so validation still bounces genuinely-empty tasks.
 */
export function recoverMissingTaskPrompts(input: unknown): unknown {
	if (typeof input !== "object" || input === null) {
		return input;
	}
	const record = input as Record<string, unknown>;
	if (!Array.isArray(record.tasks)) {
		return input;
	}
	let changed = false;
	const tasks = record.tasks.map((task) => {
		if (typeof task !== "object" || task === null) {
			return task;
		}
		const entry = task as Record<string, unknown>;
		if (decomposeProjectFieldIsUsable(entry.prompt)) {
			return task;
		}
		for (const key of ["description", "details", "title"] as const) {
			const value = entry[key];
			if (typeof value === "string" && value.trim().length > 0) {
				changed = true;
				return { ...entry, prompt: value.trim() };
			}
		}
		return task;
	});
	return changed ? { ...record, tasks } : input;
}

export function formatCompactSchemaIssues(error: z.ZodError, limit = 3): string {
	const issues = error.issues
		.slice(0, limit)
		.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
		.join("; ");
	const remaining = error.issues.length - limit;
	return remaining > 0 ? `${issues} (+${remaining} more)` : issues;
}

/**
 * Parse-and-recover for a STRINGIFIED array/object field (live-found sweep run 8, 2026-07-08: qwopus3.5 emitted
 * `tasks` as a JSON STRING `"[{...}]"` instead of an array — a classic weak-model nested-JSON stringification, so the
 * schema saw a 2978-char string, not tasks, and the whole decompose bounced). JSON.parse a string-valued
 * `tasks`/`questions`/`expansions` back into its structure BEFORE schema validation (and before the other recoveries,
 * which early-return when `tasks` isn't an array). A non-string or unparseable value is left untouched — validation
 * still guides. Pure.
 */
export function recoverStringifiedDecomposeArrays(input: unknown): unknown {
	if (typeof input !== "object" || input === null) {
		return input;
	}
	const record = input as Record<string, unknown>;
	let changed = false;
	const next: Record<string, unknown> = { ...record };
	for (const key of ["tasks", "questions", "expansions"] as const) {
		const value = record[key];
		if (typeof value !== "string") {
			continue;
		}
		const trimmed = value.trim();
		if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
			try {
				next[key] = JSON.parse(trimmed);
				changed = true;
			} catch {
				// Unparseable — leave the string so schema validation surfaces a clear error.
			}
		}
	}
	return changed ? next : input;
}

export function normalizeDecomposeProjectToolInput(input: unknown): DecomposeProjectToolInput {
	assertUsableDecomposeProjectInput(input);
	const result = decomposeProjectToolInputSchema.safeParse(
		recoverMissingTaskPrompts(recoverMissingDecomposeProjectTitle(recoverStringifiedDecomposeArrays(input))),
	);
	if (!result.success) {
		throw new Error(
			`decompose_project input failed validation — ${formatCompactSchemaIssues(result.error)}. ` +
				"Each task needs id, title, and prompt (strings); remove any other keys. Fix these and resubmit the whole call.",
		);
	}
	const parsed = result.data;
	const defaultAcceptanceCommand = parsed.defaultAcceptanceCommand?.trim() || null;
	if (parsed.tasks.length === 0) {
		throw new Error(
			"decompose_project requires at least one task. Add 3 to 6 task objects (id, title, prompt) to tasks and resubmit.",
		);
	}
	const questions = deriveOpenQuestionDefaults(parsed.questions ?? []);
	validatePlanQuestions(questions);
	const expansions = parsed.expansions ?? {};
	const tasks = expandDecomposeProjectTasks({
		tasks: parsed.tasks,
		expansions,
		defaultAcceptanceCommand,
	});
	const minimumTaskCount = parsed.minimumTaskCount ?? null;
	if (minimumTaskCount !== null && tasks.length < minimumTaskCount) {
		throw new Error(
			`decompose_project requires at least ${minimumTaskCount} task leaves; received ${tasks.length}. Split the plan into more independently reviewable tasks.`,
		);
	}
	// F1.8: work-package shape BY CONSTRUCTION — every card gets a bounded writeScope (explicit, else derived
	// from filesLikelyTouched) and the graph carries its hot-file classification. Both decompose modes (one-shot
	// and the incremental add_task protocol) flow through here, so no emitted graph skips the shaping.
	const shaped = populateWorkPackageShape(tasks);
	const taskGraph = {
		schemaVersion: 1 as const,
		slug: parsed.slug,
		title: parsed.title.trim() || parsed.slug,
		tasks: shaped.tasks,
		...(shaped.hotFiles.length > 0 ? { hotFiles: shaped.hotFiles } : {}),
	};
	return {
		slug: parsed.slug,
		spec: parsed.spec,
		plan: parsed.plan,
		summary: parsed.summary?.trim() || null,
		questions,
		title: parsed.title,
		tasks: shaped.tasks,
		taskGraph,
		defaultAcceptanceCommand,
		minimumTaskCount,
		expansions,
	};
}
