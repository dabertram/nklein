import { createHash } from "node:crypto";
import { decodePngToRgba } from "../core/png-decode";
import { comparePixels, decideVisualGate, type VisualGateDecision } from "../core/visual-verification-gate";
import { readVisualBaseline, writeVisualBaseline } from "../state/visual-baseline-store";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import { runSandboxToolchainSetup } from "./nklein-sandbox-toolchain-setup";

export interface SandboxVisualDeliveryResult {
	readonly applicability: "applicable" | "not_applicable";
	readonly decision: VisualGateDecision | null;
	readonly screenshotPngBase64: string | null;
	readonly route: string;
	readonly framework: string | null;
	readonly baselineKey: string | null;
}

let visualSessionSequence = 0;

function parseCaptureResult(value: string): {
	rendered: boolean;
	consoleErrors: string[];
	pngBase64: string | null;
	route: string;
	framework: string | null;
} {
	const parsed = JSON.parse(value) as Record<string, unknown>;
	return {
		rendered: parsed.rendered === true,
		consoleErrors: Array.isArray(parsed.consoleErrors)
			? parsed.consoleErrors.filter((error): error is string => typeof error === "string").slice(0, 20)
			: [],
		pngBase64: typeof parsed.pngBase64 === "string" ? parsed.pngBase64 : null,
		route: typeof parsed.route === "string" && parsed.route.startsWith("/") ? parsed.route : "/",
		framework: typeof parsed.framework === "string" ? parsed.framework : null,
	};
}

export async function verifyCurrentBuildVisualInSandbox(input: {
	readonly taskId: string;
	readonly projectRepoPath: string;
	readonly baseRef: string;
	readonly resultCommit?: string | null;
	readonly route?: string;
	readonly timeoutMs?: number;
	readonly width?: number;
	readonly height?: number;
	readonly maxDiffPixelRatio?: number;
	readonly baselineRootDir?: string;
	readonly sandboxManager: AgentSandboxManager;
}): Promise<SandboxVisualDeliveryResult> {
	const resultCommit =
		(input.resultCommit?.trim() ?? "") ||
		(await resolveTaskResultBranchCommit({ repoPath: input.projectRepoPath, taskId: input.taskId }).catch(
			() => null,
		));
	if (!resultCommit) {
		throw new Error(`Visual verification requires the exact delivered commit for task ${input.taskId}.`);
	}
	visualSessionSequence += 1;
	const sandboxTaskId = `${input.taskId}::visual-${visualSessionSequence}`;
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
		const hasJavaScript = setup.plan.toolchains.some((toolchain) => toolchain.language === "javascript");
		if (!hasJavaScript) {
			return {
				applicability: "not_applicable",
				decision: null,
				screenshotPngBase64: null,
				route: input.route?.trim() || "/",
				framework: null,
				baselineKey: null,
			};
		}
		if (setup.status === "failed") {
			return {
				applicability: "applicable",
				decision: { verdict: "fail", reason: setup.reason },
				screenshotPngBase64: null,
				route: input.route?.trim() || "/",
				framework: null,
				baselineKey: null,
			};
		}
		const capture = parseCaptureResult(
			await input.sandboxManager.runTool(sandboxTaskId, "visualCapture", {
				route: input.route,
				timeoutMs: input.timeoutMs,
				width: input.width,
				height: input.height,
			}),
		);
		const png = capture.pngBase64 ? Buffer.from(capture.pngBase64, "base64") : null;
		const image = png ? decodePngToRgba(png) : null;
		const workspaceKey = createHash("sha256").update(input.projectRepoPath).digest("hex").slice(0, 20);
		const baselineKey = `${workspaceKey}:${capture.route}:${input.width ?? 1280}x${input.height ?? 800}`;
		const storeOptions = input.baselineRootDir ? { rootDir: input.baselineRootDir } : {};
		const baseline = await readVisualBaseline(baselineKey, storeOptions);
		const decision = decideVisualGate({
			rendered: capture.rendered && image !== null,
			consoleErrors: capture.consoleErrors,
			pixelDiff: image && baseline ? comparePixels(baseline, image) : null,
			maxDiffPixelRatio: input.maxDiffPixelRatio,
		});
		if (decision.verdict === "baseline_created" && image) {
			await writeVisualBaseline(baselineKey, image, storeOptions);
		}
		return {
			applicability: "applicable",
			decision,
			screenshotPngBase64: capture.pngBase64,
			route: capture.route,
			framework: capture.framework,
			baselineKey,
		};
	} finally {
		await input.sandboxManager.disposeWorkspace(sandboxTaskId).catch(() => null);
	}
}
