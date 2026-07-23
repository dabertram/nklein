import { deriveSpecInvariants, renderPropertyScaffold } from "../core/spec-invariant-derivation";
import { getTaskResultBranchDiff, resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import type { PropertyBindingModelCaller } from "./nklein-property-binding-model-caller";
import { runSandboxToolchainSetup } from "./nklein-sandbox-toolchain-setup";

export interface PropertyAcceptanceResult {
	readonly outcome: "pass" | "fail" | "unavailable";
	readonly reason: string;
	readonly output: string;
	readonly invariantCount: number;
}

let propertySessionSequence = 0;

function parseSandboxResult(value: string): { status: "pass" | "fail" | "not_run"; reason: string; output: string } {
	const parsed = JSON.parse(value) as Record<string, unknown>;
	const status = parsed.status;
	if (status !== "pass" && status !== "fail" && status !== "not_run") {
		throw new Error("Sandbox property check returned an invalid status.");
	}
	return {
		status,
		reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 2_000) : "property check returned no reason",
		output: typeof parsed.output === "string" ? parsed.output.slice(-16_000) : "",
	};
}

/**
 * Bind deterministic spec-derived invariants with an independent model, then execute only the admitted test in a
 * fresh sandbox checked out at the exact delivered commit. No invariants/binding/harness => unavailable, never pass.
 */
export async function verifyPropertiesInSandbox(input: {
	readonly taskId: string;
	readonly projectRepoPath: string;
	readonly baseRef: string;
	readonly taskPrompt: string;
	readonly resultCommit?: string | null;
	readonly timeoutMs?: number;
	readonly sandboxManager: AgentSandboxManager;
	readonly bindProperties?: PropertyBindingModelCaller | null;
}): Promise<PropertyAcceptanceResult> {
	const invariants = deriveSpecInvariants(input.taskPrompt);
	if (invariants.length === 0) {
		return {
			outcome: "unavailable",
			reason: "the spec states no derivable invariants",
			output: "",
			invariantCount: 0,
		};
	}
	const scaffold = renderPropertyScaffold(invariants);
	if (!scaffold || !input.bindProperties) {
		return {
			outcome: "unavailable",
			reason: input.bindProperties
				? "no property scaffold could be derived"
				: "no local property-binding model is available",
			output: "",
			invariantCount: invariants.length,
		};
	}
	const resultCommit =
		(input.resultCommit?.trim() ?? "") ||
		(await resolveTaskResultBranchCommit({ repoPath: input.projectRepoPath, taskId: input.taskId }).catch(
			() => null,
		));
	if (!resultCommit) {
		return {
			outcome: "unavailable",
			reason: "the exact delivered commit could not be resolved",
			output: "",
			invariantCount: invariants.length,
		};
	}
	const patch = await getTaskResultBranchDiff({
		repoPath: input.projectRepoPath,
		taskId: input.taskId,
		baseRef: input.baseRef,
		resultCommit,
	}).catch(() => null);
	if (!patch) {
		return {
			outcome: "unavailable",
			reason: "the delivered patch could not be read for independent binding",
			output: "",
			invariantCount: invariants.length,
		};
	}
	// Model inference must not occupy a scarce sandbox slot. The binder reads only the deterministic invariant set and
	// exact delivered patch; allocate Docker only after it returns an executable proposal.
	const proposal = await input.bindProperties({ invariants, scaffold, patch });
	if (proposal.status === "unavailable") {
		return {
			outcome: "unavailable",
			reason: proposal.rationale,
			output: "",
			invariantCount: invariants.length,
		};
	}
	propertySessionSequence += 1;
	const sandboxTaskId = `${input.taskId}::property-${propertySessionSequence}`;
	await input.sandboxManager.assertAvailable();
	await input.sandboxManager.prepareWorkspace({
		taskId: sandboxTaskId,
		projectRepoPath: input.projectRepoPath,
		baseRef: resultCommit,
	});
	try {
		const rootFileNames = (await input.sandboxManager.listSandboxRootFileNames?.(sandboxTaskId)) ?? [];
		const setup = await runSandboxToolchainSetup({
			rootFileNames,
			timeoutMs: input.timeoutMs ?? 120_000,
			runCommand: async ({ command, timeoutMs }) =>
				await input.sandboxManager.exec(sandboxTaskId, ["/bin/sh", "-lc", command], { timeoutMs }),
		});
		if (!setup.plan.toolchains.some((toolchain) => toolchain.language === "javascript")) {
			return {
				outcome: "unavailable",
				reason: "the delivered repository is not a JavaScript/TypeScript property-test target",
				output: "",
				invariantCount: invariants.length,
			};
		}
		if (setup.status === "failed") {
			return {
				outcome: "unavailable",
				reason: setup.reason,
				output: setup.steps.at(-1)?.output ?? "",
				invariantCount: invariants.length,
			};
		}
		const run = parseSandboxResult(
			await input.sandboxManager.runTool(sandboxTaskId, "propertyCheck", {
				testCode: proposal.testCode,
				invariants,
				timeoutMs: input.timeoutMs,
			}),
		);
		if (run.status === "not_run") {
			return { outcome: "unavailable", reason: run.reason, output: run.output, invariantCount: invariants.length };
		}
		return { outcome: run.status, reason: run.reason, output: run.output, invariantCount: invariants.length };
	} finally {
		await input.sandboxManager.disposeWorkspace(sandboxTaskId).catch(() => null);
	}
}
