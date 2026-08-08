import type { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { IMPLEMENT_RESULT_SENTINEL } from "../../../src/core/implement-eval-harness";
import { runImplementCandidate } from "../../../src/nklein-agent/nklein-implement-sandbox";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * It runs a local model's candidate implementation inside a `node --permission` child. The header makes a
 * specific claim about what that boundary denies — and a claim about a boundary is exactly the kind that decays
 * into decoration, because a sandbox that has quietly stopped sandboxing looks identical from the outside. So
 * the first suite below does not assert the flags: it RUNS candidates that reach for the filesystem and for
 * `child_process` and requires them to be refused.
 *
 * The second concentration is the module's own hard-won defect, recorded in a comment: `tmpdir()` on macOS
 * returns `/var/folders/...`, a SYMLINK to `/private/var/folders/...`, and Node's permission model matches the
 * RESOLVED path. Granting the symlinked form denies the child its own script, and every run then returns "no
 * evidence" — silently, and indistinguishably from a model whose code hung. That is a boundary misconfiguration
 * wearing the costume of a legitimate null, and nothing about the result says which one it was.
 *
 * Note on ordering: if `--permission` were dropped, "scores a correct candidate" and every argv assertion would
 * still pass — only the two EXECUTED denial probes would go red. That is precisely why they are executed rather
 * than inspected.
 */
// An assertion is an EXPRESSION whose truthiness is the verdict — the harness evaluates `await (<assertion>)`.
const OK = { name: "adds", assertion: "add(2,2) === 4" };

/** Captures the argv the module would have handed to a real child, without spawning one. */
function spyRunner(stdout: string, options: { exitCode?: number } = {}) {
	const calls: { args: string[]; options: Record<string, unknown> }[] = [];
	const impl = ((_file: string, args: string[], opts: Record<string, unknown>, callback: Function) => {
		calls.push({ args, options: opts });
		const error = options.exitCode ? Object.assign(new Error("exit"), { code: options.exitCode }) : null;
		queueMicrotask(() => callback(error, stdout, ""));
		return undefined;
	}) as unknown as typeof execFile;
	return { calls, impl };
}

function sentinel(payload: Record<string, unknown>): string {
	return `\n${IMPLEMENT_RESULT_SENTINEL}${JSON.stringify(payload)}\n`;
}

describe("the real boundary", () => {
	it("scores a correct candidate against its assertions", async () => {
		// The pipe end to end, through a genuine child process — nothing mocked.
		const result = await runImplementCandidate({
			code: "function add(a, b) { return a + b; }",
			tests: [OK, { name: "negatives", assertion: "add(-1,-1) === -2" }],
		});

		expect(result).toEqual({ passed: 2, total: 2, failures: [] });
	});

	it("DENIES the candidate a filesystem read outside its own directory", async () => {
		// The header's central claim, executed rather than asserted. A candidate reading `/etc/hosts` must be
		// refused by the permission model — if this ever passes, the sandbox has stopped sandboxing while every
		// other test in this file still goes green.
		const result = await runImplementCandidate({
			code: "function probe() { return require('fs').readFileSync('/etc/hosts', 'utf8'); }",
			tests: [{ name: "reads a host file", assertion: "probe()" }],
		});

		expect(result?.passed).toBe(0);
		expect(JSON.stringify(result?.failures)).toMatch(/ERR_ACCESS_DENIED|not allowed|permission/i);
	});

	it("DENIES the candidate a child process", async () => {
		const result = await runImplementCandidate({
			code: "function probe() { return require('child_process').execSync('echo escaped').toString(); }",
			tests: [{ name: "spawns", assertion: "probe()" }],
		});

		expect(result?.passed).toBe(0);
		expect(JSON.stringify(result?.failures)).toMatch(/ERR_ACCESS_DENIED|not allowed|permission/i);
	});

	it("runs a CLASS-based candidate — the true-top-level scoping defect", async () => {
		// A real regression, recorded in the module it calls: wrapping the candidate in a `try` block left
		// block-scoped `class`/`let`/`const` declarations invisible to the assertions, so every class-based prompt
		// scored 0 while function-based ones passed through hoisting and hid it. A test asserting the script TEXT
		// contained the candidate stayed green throughout — only executing it showed the scoping.
		const result = await runImplementCandidate({
			code: "class Counter { constructor() { this.n = 0; } inc() { return ++this.n; } }",
			tests: [
				{ name: "counts", assertion: "(() => { const c = new Counter(); c.inc(); return c.inc(); })() === 2" },
			],
		});

		expect(result).toEqual({ passed: 1, total: 1, failures: [] });
	});

	it("returns NULL for a non-terminating candidate rather than a zero it did not earn", async () => {
		// The distinction the module states outright: "failed every test" and "produced no evidence" are different
		// facts, and the eval runner must not score a hung child as a model that got everything wrong.
		const result = await runImplementCandidate({
			code: "function spin() { while (true) {} }",
			tests: [{ name: "spins", assertion: "spin()" }],
			timeoutMs: 2_000,
		});

		expect(result).toBeNull();
	});

	it("reports a definition-time throw as every test failing, with the reason", async () => {
		const result = await runImplementCandidate({
			code: "throw new Error('candidate did not even parse into existence');",
			tests: [OK, { name: "second", assertion: "add(1,1) === 2" }],
		});

		expect(result?.passed).toBe(0);
		expect(result?.total).toBe(2);
		expect(JSON.stringify(result?.failures)).toMatch(/did not even parse/);
	});
});

describe("how the child is launched", () => {
	it("grants fs-read on the RESOLVED path, not the symlink tmpdir() hands back", async () => {
		// The macOS defect, pinned by the property rather than by the platform: whatever path is granted must
		// already be canonical. Granting `/var/folders/...` where the kernel sees `/private/var/folders/...` denies
		// the child its own harness script, and every run then returns a null that looks exactly like a timeout.
		const { calls, impl } = spyRunner(sentinel({ passed: 1, total: 1, failures: [] }));
		await runImplementCandidate({ code: "function add(a,b){return a+b}", tests: [OK], execFileImpl: impl });

		const granted = calls[0]?.args
			.find((arg) => arg.startsWith("--allow-fs-read="))
			?.slice("--allow-fs-read=".length);
		// Compared against the CANONICAL temp root rather than by re-resolving the path, because the directory is
		// already deleted by the time this runs. On macOS `tmpdir()` is `/var/folders/...` and its real form is
		// `/private/var/folders/...`; dropping the `realpath` would grant the former, which the kernel never
		// matches.
		expect(granted).toBeDefined();
		expect(granted?.startsWith(realpathSync(tmpdir()))).toBe(true);
	});

	it("passes --permission and scopes the read to that ONE directory", async () => {
		// The grant is the entire attack surface the boundary deliberately leaves open; a second `--allow-*` flag
		// would widen it without changing any result this suite observes.
		const { calls, impl } = spyRunner(sentinel({ passed: 1, total: 1, failures: [] }));
		await runImplementCandidate({ code: "function add(a,b){return a+b}", tests: [OK], execFileImpl: impl });

		const args = calls[0]?.args ?? [];
		expect(args).toContain("--permission");
		expect(args.filter((arg) => arg.startsWith("--allow-"))).toHaveLength(1);
		const granted = args[1]?.slice("--allow-fs-read=".length);
		// The script it runs lives inside the one directory it may read, and nowhere else is granted.
		expect(args[2]?.startsWith(`${granted}/`)).toBe(true);
	});

	it("kills a runaway child with SIGKILL, not a signal it could ignore", async () => {
		const { calls, impl } = spyRunner(sentinel({ passed: 1, total: 1, failures: [] }));
		await runImplementCandidate({ code: "function add(a,b){return a+b}", tests: [OK], execFileImpl: impl });

		expect(calls[0]?.options).toMatchObject({ killSignal: "SIGKILL" });
	});

	it("applies the caller's timeout, and a default when none is given", async () => {
		const first = spyRunner(sentinel({ passed: 1, total: 1, failures: [] }));
		await runImplementCandidate({ code: "x", tests: [OK], execFileImpl: first.impl, timeoutMs: 1234 });
		expect(first.calls[0]?.options).toMatchObject({ timeout: 1234 });

		const second = spyRunner(sentinel({ passed: 1, total: 1, failures: [] }));
		await runImplementCandidate({ code: "x", tests: [OK], execFileImpl: second.impl });
		expect(second.calls[0]?.options.timeout).toBeGreaterThan(0);
	});
});

describe("what counts as evidence", () => {
	it("keeps a result the candidate reported BEFORE exiting non-zero", async () => {
		// A candidate can fail loudly and still have reported honestly first. Treating the exit code as the answer
		// would discard results the harness actually produced.
		const { impl } = spyRunner(sentinel({ passed: 3, total: 4, failures: [{ name: "d", error: "nope" }] }), {
			exitCode: 1,
		});
		const result = await runImplementCandidate({ code: "x", tests: [OK], execFileImpl: impl });

		expect(result).toMatchObject({ passed: 3, total: 4 });
	});

	it("returns NULL when no sentinel was ever printed", async () => {
		const { impl } = spyRunner("some console noise but no result\n");
		expect(await runImplementCandidate({ code: "x", tests: [OK], execFileImpl: impl })).toBeNull();
	});

	it("ignores model console noise that merely LOOKS like a result", async () => {
		// The sentinel exists because a candidate may print anything at all; the last sentinel wins.
		const noise = `{"passed":99,"total":99,"failures":[]}\n`;
		const { impl } = spyRunner(noise + sentinel({ passed: 1, total: 2, failures: [] }));
		const result = await runImplementCandidate({ code: "x", tests: [OK], execFileImpl: impl });

		expect(result).toMatchObject({ passed: 1, total: 2 });
	});
});

describe("the throwaway directory", () => {
	it("is removed after a successful run", async () => {
		// It holds model-authored code. Leaving it behind accumulates untrusted files under the system temp dir.
		const { calls, impl } = spyRunner(sentinel({ passed: 1, total: 1, failures: [] }));
		await runImplementCandidate({ code: "function add(a,b){return a+b}", tests: [OK], execFileImpl: impl });

		const granted = calls[0]?.args[1]?.slice("--allow-fs-read=".length) as string;
		expect(existsSync(granted)).toBe(false);
	});

	it("is removed even when the run THROWS", async () => {
		// The cleanup sits in a `finally`; a failure path that skipped it would leak exactly the runs most worth
		// not leaving behind.
		let captured = "";
		const impl = ((_file: string, args: string[]) => {
			captured = args[1]?.slice("--allow-fs-read=".length) ?? "";
			throw new Error("spawn failed");
		}) as unknown as typeof execFile;

		expect(await runImplementCandidate({ code: "x", tests: [OK], execFileImpl: impl })).toBeNull();
		expect(captured).not.toBe("");
		expect(existsSync(captured)).toBe(false);
	});

	it("uses a FRESH directory per run", async () => {
		// Reusing one path would let a slow child from a previous run be read by the next.
		const seen = new Set<string>();
		for (let run = 0; run < 3; run += 1) {
			const { calls, impl } = spyRunner(sentinel({ passed: 1, total: 1, failures: [] }));
			await runImplementCandidate({ code: "x", tests: [OK], execFileImpl: impl });
			seen.add(calls[0]?.args[1] ?? "");
		}

		expect(seen.size).toBe(3);
	});
});
