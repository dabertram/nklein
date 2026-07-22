import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFile = promisify(execFileCallback);

export const runtimeBuildIdentitySchema = z
	.object({
		schemaVersion: z.literal(1),
		gitCommit: z
			.string()
			.regex(/^[0-9a-f]{40}$/u)
			.nullable(),
		gitDirty: z.boolean().nullable(),
		capturedAt: z.string().datetime(),
	})
	.superRefine((identity, context) => {
		if ((identity.gitCommit === null) !== (identity.gitDirty === null)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "gitCommit and gitDirty must either both be known or both be null.",
			});
		}
	});

export type RuntimeBuildIdentity = z.infer<typeof runtimeBuildIdentitySchema>;

export interface RuntimeBuildIdentityExecResult {
	stdout: string;
}

export type RuntimeBuildIdentityExec = (
	file: string,
	args: readonly string[],
	options: { cwd: string; timeout: number },
) => Promise<RuntimeBuildIdentityExecResult>;

/** Capture the runtime process's source identity once at startup; unavailable package installs remain explicit. */
export async function resolveRuntimeBuildIdentity(options?: {
	cwd?: string;
	now?: () => Date;
	exec?: RuntimeBuildIdentityExec;
}): Promise<RuntimeBuildIdentity> {
	const cwd = options?.cwd ?? process.cwd();
	const now = options?.now ?? (() => new Date());
	const run = options?.exec ?? (execFile as RuntimeBuildIdentityExec);
	try {
		const [commitResult, statusResult] = await Promise.all([
			run("git", ["rev-parse", "HEAD"], { cwd, timeout: 10_000 }),
			run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, timeout: 10_000 }),
		]);
		const gitCommit = commitResult.stdout.trim();
		if (!/^[0-9a-f]{40}$/u.test(gitCommit)) throw new Error("Git did not return a full lowercase SHA-1.");
		return {
			schemaVersion: 1,
			gitCommit,
			gitDirty: statusResult.stdout.trim().length > 0,
			capturedAt: now().toISOString(),
		};
	} catch {
		return {
			schemaVersion: 1,
			gitCommit: null,
			gitDirty: null,
			capturedAt: now().toISOString(),
		};
	}
}
