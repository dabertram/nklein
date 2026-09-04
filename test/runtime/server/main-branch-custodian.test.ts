import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildCustodianSeedPrompt,
	maybeRunMainBranchCustodian,
	resetMainBranchCustodianForTests,
	resolveCustodianModel,
} from "../../../src/server/main-branch-custodian";

describe("resolveCustodianModel (audit 2026-09-04 #14: the custodian was the last unfiltered chooser)", () => {
	const loaded = [
		{ runtimeId: "qwen3.8-flash-next", modelKey: "qwen/qwen3.8-flash-next" },
		{ runtimeId: "ornith-local-9b", modelKey: "ornith-local-9b" },
	];

	it("uses the preferred model only when it is among the routable loaded descriptors", async () => {
		const warnings: string[] = [];
		await expect(
			resolveCustodianModel({
				preferred: "qwen3.8-flash-next",
				loadRoutable: async () => loaded,
				warn: (message) => warnings.push(message),
			}),
		).resolves.toEqual({ providerId: "lmstudio", modelId: "qwen3.8-flash-next" });
		await expect(
			resolveCustodianModel({
				preferred: "qwen/qwen3.8-flash-next",
				loadRoutable: async () => loaded,
				warn: (message) => warnings.push(message),
			}),
		).resolves.toEqual({ providerId: "lmstudio", modelId: "qwen/qwen3.8-flash-next" });
		expect(warnings).toEqual([]);
	});

	it("falls back to null (the runner's filtered chain) when the preferred model is dead, colliding or unloaded", async () => {
		const warnings: string[] = [];
		await expect(
			resolveCustodianModel({
				preferred: "dirk-qwen3.8-27b",
				loadRoutable: async () => loaded.filter((descriptor) => descriptor.runtimeId !== "dirk-qwen3.8-27b"),
				warn: (message) => warnings.push(message),
			}),
		).resolves.toBeNull();
		expect(warnings).toEqual([
			"Main-branch custodian: preferred model dirk-qwen3.8-27b is not loaded/routable — letting the review runner's fallback chain pick.",
		]);
		// A failed listing is "no knowledge", never a crash — and never a blind pick either.
		await expect(
			resolveCustodianModel({
				preferred: "qwen3.8-flash-next",
				loadRoutable: async () => {
					throw new Error("lms down");
				},
				warn: () => undefined,
			}),
		).resolves.toBeNull();
	});
});

const repo = mkdtempSync(join(tmpdir(), "nklein-custodian-"));
function git(...args: string[]): void {
	execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}
function commit(name: string): void {
	writeFileSync(join(repo, name), name);
	git("add", "-A");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", name);
}

git("init", "-b", "main");
commit("seed.txt");

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("main-branch custodian (F2.35)", () => {
	beforeEach(() => {
		resetMainBranchCustodianForTests();
		process.env.NKLEIN_MAIN_CUSTODIAN = "1";
	});
	afterEach(() => {
		delete process.env.NKLEIN_MAIN_CUSTODIAN;
	});

	function deps(overrides: Partial<Parameters<typeof maybeRunMainBranchCustodian>[0]> = {}) {
		const calls = { reviews: [] as string[], cards: [] as string[], warns: [] as string[] };
		return {
			calls,
			deps: {
				workspacePath: repo,
				runReviewSession: async (input: { seedPrompt: string }) => {
					calls.reviews.push(input.seedPrompt);
					return {
						verdict: "request_changes" as const,
						summary: "duplicated clock logic in kernel and services",
						feedback: null,
						insight: null,
						preferred: null,
						blocking: false,
					};
				},
				pickCustodianModel: () => ({ providerId: "lmstudio", modelId: "test-custodian" }),
				fileFindingCard: async ({ title }: { title: string }) => {
					calls.cards.push(title);
					return "custodian-x";
				},
				warn: (message: string) => {
					calls.warns.push(message);
				},
				...overrides,
			},
		};
	}

	it("baselines silently on first sight, then reviews only when ≥3 new commits landed", async () => {
		const { calls, deps: d } = deps();
		await maybeRunMainBranchCustodian(d); // baseline
		expect(calls.reviews).toHaveLength(0);

		commit("a.txt");
		commit("b.txt");
		await maybeRunMainBranchCustodian(d); // 2 < 3 — quiet
		expect(calls.reviews).toHaveLength(0);

		commit("c.txt");
		await maybeRunMainBranchCustodian(d); // 3 commits — sweep
		expect(calls.reviews).toHaveLength(1);
		expect(calls.reviews[0]).toContain("MAIN-BRANCH CUSTODIAN");
		expect(calls.reviews[0]).toContain("a.txt");
		// request_changes files a finding card
		expect(calls.cards).toHaveLength(1);
	});

	it("advances the mark after a sweep so the same range is never re-reviewed", async () => {
		const { calls, deps: d } = deps();
		await maybeRunMainBranchCustodian(d);
		commit("d.txt");
		commit("e.txt");
		commit("f.txt");
		await maybeRunMainBranchCustodian(d);
		await maybeRunMainBranchCustodian(d); // no new commits — quiet
		expect(calls.reviews).toHaveLength(1);
	});

	it("stays fully quiet when the gate is off", async () => {
		process.env.NKLEIN_MAIN_CUSTODIAN = "0";
		const { calls, deps: d } = deps();
		commit("g.txt");
		await maybeRunMainBranchCustodian(d);
		expect(calls.reviews).toHaveLength(0);
		expect(calls.warns).toHaveLength(0);
	});

	it("seed prompt names the branch, log, and diffstat", () => {
		const prompt = buildCustodianSeedPrompt({ branch: "main", rangeLog: "abc fix x", diffstat: "1 file changed" });
		expect(prompt).toContain('branch "main"');
		expect(prompt).toContain("abc fix x");
		expect(prompt).toContain("1 file changed");
		expect(prompt).toContain("submit_review");
	});
});
