/** F5.3 terminal rendering of the same pure setup plans used by the browser wizards. */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Command } from "commander";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "../config/runtime-config.js";
import type { RuntimeSetupPlanResponse } from "../core/config-api-contract.js";
import { fetchLoadedModelIdsStrict } from "../core/lmstudio-loaded-models.js";
import { resolveDefaultLocalModelBaseUrl } from "../core/local-model-endpoint.js";
import { isKanbanRemoteHost } from "../core/runtime-endpoint.js";
import { buildGlobalSetupPlan, buildProjectSetupPlan, type DesktopAccessFacts } from "../core/setup-detection.js";
import { setupDeviceRamGbByMachine, setupModelRoleCounts } from "../core/setup-facts.js";
import { parseEgressAllowlist } from "../nklein-agent/egress-proxy-role-snapshot.js";
import { resolveAgentSandboxImageName } from "../nklein-agent/nklein-agent-sandbox-docker.js";
import { createNKleinProviderService } from "../nklein-agent/nklein-provider-service.js";

const execFileAsync = promisify(execFile);

export type SetupScope = "all" | "global" | "project";

export interface SetupCommandOptions {
	projectPath?: string;
	json?: boolean;
	scope?: string;
}

function parseSetupScope(value: string | undefined): SetupScope {
	const normalized = value?.trim().toLowerCase() || "all";
	if (normalized === "all" || normalized === "global" || normalized === "project") return normalized;
	throw new Error(`Invalid setup scope "${value}". Expected all, global, or project.`);
}

export function renderSetupPlanText(plan: RuntimeSetupPlanResponse, context?: string): string {
	const heading =
		plan.kind === "global" ? "!Klein guided setup" : `!Klein project setup${context ? ` — ${context}` : ""}`;
	const completion =
		plan.completedAt === null ? "not completed" : `last completed ${new Date(plan.completedAt).toISOString()}`;
	const lines = [`${heading} (${completion})`];
	for (const [index, step] of plan.steps.entries()) {
		lines.push("", `${index + 1}. ${step.title} [${step.stepId}]`, `   ${step.recommendation}`, `   ${step.detail}`);
	}
	return lines.join("\n");
}

async function probeDockerSetup(): Promise<{ available: boolean; vmMemoryMb: number | null }> {
	try {
		const [{ stdout }] = await Promise.all([
			execFileAsync("docker", ["info", "--format", "{{.MemTotal}}"], { timeout: 10_000 }),
			execFileAsync("docker", ["image", "inspect", resolveAgentSandboxImageName()], { timeout: 10_000 }),
		]);
		const bytes = Number.parseInt(stdout.trim(), 10);
		return {
			available: true,
			vmMemoryMb: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / (1024 * 1024)) : null,
		};
	} catch {
		return { available: false, vmMemoryMb: null };
	}
}

async function detectBaseBranch(projectPath: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", projectPath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
			{ timeout: 4_000 },
		);
		const ref = stdout.trim();
		return ref.includes("/") ? (ref.split("/").pop() ?? null) : ref || null;
	} catch {
		return null;
	}
}

async function readPackageJson(projectPath: string): Promise<{ scripts?: Record<string, string> } | null> {
	try {
		return JSON.parse(await readFile(resolve(projectPath, "package.json"), "utf8")) as {
			scripts?: Record<string, string>;
		};
	} catch {
		return null;
	}
}

export async function buildCliSetupPlans(input: {
	projectPath: string;
	scope: SetupScope;
}): Promise<RuntimeSetupPlanResponse[]> {
	const includeGlobal = input.scope !== "project";
	const includeProject = input.scope !== "global";
	const [globalConfig, scopedConfig, docker, packageJson, detectedBaseBranch] = await Promise.all([
		includeGlobal ? loadGlobalRuntimeConfig() : Promise.resolve(null),
		includeProject ? loadRuntimeConfig(input.projectPath) : Promise.resolve(null),
		includeGlobal ? probeDockerSetup() : Promise.resolve(null),
		includeProject ? readPackageJson(input.projectPath) : Promise.resolve(null),
		includeProject ? detectBaseBranch(input.projectPath) : Promise.resolve(null),
	]);
	const providerEndpoint = createNKleinProviderService().getLocalChatBaseUrl() ?? resolveDefaultLocalModelBaseUrl();
	let loadedModelIds: readonly string[] = [];
	let providerReachable = false;
	try {
		loadedModelIds = await fetchLoadedModelIdsStrict(providerEndpoint);
		providerReachable = true;
	} catch {
		// The plan reports the endpoint as unreachable; setup itself remains useful offline.
	}
	const desktopAccess: DesktopAccessFacts = {
		desktopShellConnected: Boolean(process.env.NKLEIN_DESKTOP_NONCE?.trim()),
		remoteAccessEnabled: isKanbanRemoteHost(),
		// This process is not the server and cannot know whether its advanced no-auth escape hatch was used.
		remoteAuthenticationEnabled: isKanbanRemoteHost() ? null : true,
	};
	const configForFleet = globalConfig ?? scopedConfig;
	if (!configForFleet) throw new Error("Setup requested no plan scope.");
	const deviceRamGbByMachine = setupDeviceRamGbByMachine({
		configuredDeviceRamGb: configForFleet.deviceRamGb,
	});
	const plans: RuntimeSetupPlanResponse[] = [];
	if (includeGlobal && globalConfig && docker) {
		const globalRoleCounts = setupModelRoleCounts(globalConfig.modelRoles);
		plans.push({
			kind: "global",
			completedAt: globalConfig.setupWizardCompletedAt,
			steps: buildGlobalSetupPlan({
				totalRamMb: Math.round(totalmem() / (1024 * 1024)),
				cpuCount: cpus().length,
				loadedModelCount: loadedModelIds.length,
				providerReachable,
				providerEndpoint,
				dockerAvailable: docker.available,
				dockerVmMemoryMb: docker.vmMemoryMb,
				secondOpinionReviewEnabled: globalConfig.secondOpinionReviewEnabled,
				assignedModelRoleCount: globalRoleCounts.assigned,
				totalModelRoleCount: globalRoleCounts.total,
				deviceRamGbByMachine,
				basicMemoryEnabled: globalConfig.basicMemoryEnabled,
				sandboxMcpServersEnabled: globalConfig.sandboxMcpServersEnabled,
				memoryFreshnessAuditEnabled: globalConfig.memoryFreshnessAudit.enabled,
				egressProxyEnabled: globalConfig.sandboxEgressProxyEnabled,
				egressAllowlistCount: parseEgressAllowlist(globalConfig.sandboxEgressAllowlist).length,
				retrievalEgressEnabled: globalConfig.retrievalEgressEnabled,
				desktopAccess,
			}),
		});
	}
	if (includeProject && scopedConfig) {
		const scopedRoleCounts = setupModelRoleCounts(scopedConfig.effectiveModelRoles);
		plans.push({
			kind: "project",
			completedAt: scopedConfig.projectSetupWizardCompletedAt,
			steps: buildProjectSetupPlan({
				packageJson,
				loadedModelCount: loadedModelIds.length,
				cpuCount: cpus().length,
				detectedBaseBranch,
				isolationProfile: scopedConfig.effectiveSandboxIsolationProfile,
				assignedModelRoleCount: scopedRoleCounts.assigned,
				totalModelRoleCount: scopedRoleCounts.total,
				deviceRamGbByMachine,
				basicMemoryEnabled: scopedConfig.basicMemoryEnabled,
				sandboxMcpServersEnabled: scopedConfig.effectiveSandboxMcpServersEnabled,
				memoryFreshnessAuditEnabled: scopedConfig.memoryFreshnessAudit.enabled,
				egressProxyEnabled: scopedConfig.sandboxEgressProxyEnabled,
				egressAllowlistCount: parseEgressAllowlist(scopedConfig.sandboxEgressAllowlist).length,
				retrievalEgressEnabled: scopedConfig.retrievalEgressEnabled,
				desktopAccess,
			}),
		});
	}
	return plans;
}

export function registerSetupCommand(
	program: Command,
	deps: {
		buildPlans?: typeof buildCliSetupPlans;
		write?: (text: string) => void;
		cwd?: () => string;
	} = {},
): void {
	program
		.command("setup")
		.description("Inspect guided setup recommendations without opening the browser.")
		.option("--project-path <path>", "Project path for project-scoped recommendations (defaults to cwd).")
		.option("--scope <scope>", "Plan scope: all, global, or project.", "all")
		.option("--json", "Emit the exact setup-plan model as JSON.")
		.action(async (options: SetupCommandOptions) => {
			const projectPath = resolve(options.projectPath ?? (deps.cwd ?? process.cwd)());
			const plans = await (deps.buildPlans ?? buildCliSetupPlans)({
				projectPath,
				scope: parseSetupScope(options.scope),
			});
			const output = options.json
				? JSON.stringify(plans, null, 2)
				: plans
						.map((plan) => renderSetupPlanText(plan, plan.kind === "project" ? projectPath : undefined))
						.join("\n\n");
			(deps.write ?? console.log)(output);
		});
}
