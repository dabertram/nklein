import { execFile } from "node:child_process";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { validateBoundPropertyTest } from "../../core/property-binding-contract";
import type { SpecInvariant } from "../../core/spec-invariant-derivation";

const execFileAsync = promisify(execFile);
const GENERATED_DIR = ".nklein-property-gate";
const GENERATED_FILE = "property.generated.test.ts";

export interface SandboxPropertyCheckResult {
	readonly status: "pass" | "fail" | "not_run";
	readonly reason: string;
	readonly output: string;
}

function isHarnessFailure(output: string): boolean {
	return /(?:failed to load url|cannot find (?:module|package)|transform failed|failed to resolve import|no test files found|syntaxerror)/i.test(
		output,
	);
}

async function ensureRuntimeLink(generatedDir: string, name: "fast-check" | "vitest"): Promise<void> {
	// Resolve the gate's imports from its own private module directory. A repository-declared dependency with the same
	// name must never shadow the image-pinned verifier runtime or turn candidate-controlled package contents into oracle.
	const moduleDir = join(generatedDir, "node_modules");
	const target = join(moduleDir, name);
	await mkdir(moduleDir, { recursive: true });
	await symlink(join("/opt/nklein/node_modules", name), target, "dir");
}

/** Execute admitted binder output in the disposable network-none task container and remove every generated artifact. */
export async function runSandboxPropertyCheck(
	input: { testCode: string; invariants: readonly SpecInvariant[]; timeoutMs?: number },
	cwd: string,
): Promise<SandboxPropertyCheckResult> {
	const validation = validateBoundPropertyTest(input.testCode, input.invariants);
	if (!validation.valid) return { status: "not_run", reason: validation.reason, output: "" };
	const generatedDir = join(cwd, GENERATED_DIR);
	const generatedFile = join(generatedDir, GENERATED_FILE);
	try {
		// The candidate tree may already contain this path (including as a symlink). Recreate it before writing so the
		// harness cannot be redirected outside its private disposable directory.
		await rm(generatedDir, { recursive: true, force: true });
		await mkdir(generatedDir, { recursive: true });
		await writeFile(generatedFile, input.testCode, { encoding: "utf8", mode: 0o600 });
		for (const dependency of ["fast-check", "vitest"] as const) {
			await ensureRuntimeLink(generatedDir, dependency);
		}
		const timeout = Math.min(Math.max(input.timeoutMs ?? 120_000, 5_000), 300_000);
		try {
			const result = await execFileAsync(
				"/opt/nklein/node_modules/.bin/vitest",
				["run", `${GENERATED_DIR}/${GENERATED_FILE}`],
				{ cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: "1", NO_COLOR: "1" } },
			);
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-16_000);
			return { status: "pass", reason: validation.reason, output };
		} catch (error) {
			const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
			const output = [record.stdout, record.stderr, error instanceof Error ? error.message : String(error)]
				.filter((part): part is string => typeof part === "string" && part.length > 0)
				.join("\n")
				.slice(-16_000);
			if (isHarnessFailure(output)) {
				return {
					status: "not_run",
					reason: "the generated property harness could not compile or resolve imports",
					output,
				};
			}
			return { status: "fail", reason: "at least one spec-derived property was falsified", output };
		}
	} finally {
		await rm(generatedDir, { recursive: true, force: true }).catch(() => null);
	}
}
