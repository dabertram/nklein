import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import {
	closeInheritedDebtForPassingCommand,
	foldInheritedDebtSighting,
	type InheritedDebtRecord,
} from "../core/inherited-debt";

/**
 * Durable home for inherited debt (see `src/core/inherited-debt.ts` for why it exists).
 *
 * Persisted deliberately: the whole point is that a pre-existing breakage is not forgotten. A process-local ledger
 * would be cleared by the next restart, which is exactly how the breakage used to disappear — silently, with every
 * gate still green. Whole-file JSON rather than an append log because records MUTATE (encounters rise, debts close).
 */
export const inheritedDebtRecordSchema = z.object({
	schemaVersion: z.literal(1),
	signature: z.string(),
	workspacePath: z.string().nullable(),
	command: z.string(),
	firstSeenTaskId: z.string(),
	firstSeenAt: z.number(),
	lastSeenAt: z.number(),
	encounters: z.number(),
	baselineOutputHead: z.string(),
	baselineExitCode: z.number().nullable(),
	status: z.enum(["open", "closed"]),
	closedAt: z.number().nullable(),
}) satisfies z.ZodType<InheritedDebtRecord>;

const inheritedDebtFileSchema = z.object({
	schemaVersion: z.literal(1),
	debts: z.array(inheritedDebtRecordSchema),
});

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "inherited-debt");

function resolveRootDir(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}

function resolveFilePath(workspacePath: string | null, rootDir?: string): string {
	const key = workspacePath?.trim() || "unknown";
	return join(resolveRootDir(rootDir), `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.json`);
}

/** Every recorded debt for a workspace, open and closed. Unreadable or corrupt state reads as empty, never throws. */
export async function readInheritedDebt(
	workspacePath: string | null,
	options?: { rootDir?: string },
): Promise<InheritedDebtRecord[]> {
	try {
		const raw = await readFile(resolveFilePath(workspacePath, options?.rootDir), "utf8");
		const parsed = inheritedDebtFileSchema.safeParse(JSON.parse(raw));
		return parsed.success ? [...parsed.data.debts] : [];
	} catch {
		return [];
	}
}

/** Only what is still owed — what the architect must plan to fix. */
export async function readOpenInheritedDebt(
	workspacePath: string | null,
	options?: { rootDir?: string },
): Promise<InheritedDebtRecord[]> {
	return (await readInheritedDebt(workspacePath, options)).filter((record) => record.status === "open");
}

async function write(
	workspacePath: string | null,
	debts: readonly InheritedDebtRecord[],
	options?: { rootDir?: string },
): Promise<void> {
	const filePath = resolveFilePath(workspacePath, options?.rootDir);
	await mkdir(resolveRootDir(options?.rootDir), { recursive: true });
	await writeFile(filePath, `${JSON.stringify({ schemaVersion: 1, debts }, null, "\t")}\n`, "utf8");
}

/**
 * Record one sighting of an inherited breakage. Returns the resulting record and whether this opened NEW debt (as
 * opposed to another card meeting debt already known), so the caller can log the two cases differently.
 */
export async function recordInheritedDebtSighting(
	input: {
		workspacePath: string | null;
		command: string;
		taskId: string;
		signature: string;
		baselineOutput: string;
		baselineExitCode: number | null;
		at?: number;
	},
	options?: { rootDir?: string },
): Promise<{ record: InheritedDebtRecord | null; opened: boolean }> {
	try {
		const existing = await readInheritedDebt(input.workspacePath, options);
		const before = existing.filter((record) => record.status === "open").length;
		const next = foldInheritedDebtSighting(existing, {
			signature: input.signature,
			workspacePath: input.workspacePath,
			command: input.command,
			taskId: input.taskId,
			baselineOutput: input.baselineOutput,
			baselineExitCode: input.baselineExitCode,
			at: input.at ?? Date.now(),
		});
		await write(input.workspacePath, next, options);
		const record = next.find((candidate) => candidate.signature === input.signature) ?? null;
		return { record, opened: next.filter((candidate) => candidate.status === "open").length > before };
	} catch {
		// Debt bookkeeping must never break a delivery; an unwritable ledger is a visibility loss, not a failure.
		return { record: null, opened: false };
	}
}

/** Retire every open debt for a command now proven green at base. Returns what was closed. */
export async function closeInheritedDebt(
	input: { workspacePath: string | null; command: string; at?: number },
	options?: { rootDir?: string },
): Promise<InheritedDebtRecord[]> {
	try {
		const existing = await readInheritedDebt(input.workspacePath, options);
		const { records, closed } = closeInheritedDebtForPassingCommand(existing, input.command, input.at ?? Date.now());
		if (closed.length > 0) {
			await write(input.workspacePath, records, options);
		}
		return closed;
	} catch {
		return [];
	}
}
