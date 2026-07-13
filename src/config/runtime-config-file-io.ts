// §5.U cohesive extraction (2026-07-07): config-file PERSISTENCE I/O, lifted out of the large runtime-config.ts.
// Reads a config.json (returning null on first-run ENOENT, backing up corrupt JSON before returning null), and writes
// the global + per-project config files atomically under a lock — the project write normalizes every override field and
// deletes an emptied project config. Imports-only (no config state, no `this`); runtime-config.ts imports these back.
import { copyFile, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeCodeEmbeddingSettings,
	RuntimeFileOverlapParallelism,
	RuntimeModelRoles,
	RuntimeModelSuitabilityPolicy,
	RuntimeProjectShortcut,
	RuntimeSandboxIsolationProfile,
	RuntimeSkillDynamicsLevel,
} from "../core/api-contract";
import { type ConcurrencyOverride, normalizeConcurrencyOverride } from "../core/concurrency-config";
import { lockedFileSystem } from "../fs/locked-file-system";
import {
	normalizeAgentRulesetsOverride,
	normalizeCodeEmbeddingOverride,
	normalizeMaxConcurrentTasksOverride,
	normalizeModelRolesOverride,
	normalizeModelSuitabilityPolicyOverride,
	normalizeSelectedAgentIdOverride,
	normalizeShortcuts,
	normalizeSkillDynamicsLevelOverride,
	normalizeTestDrivenModeOverride,
} from "./runtime-config-normalizers";
import { normalizeFileOverlapParallelismOverride } from "./runtime-config-overlap-resolver";
import { normalizeRuntimeSandboxIsolationProfileOverride } from "./runtime-config-sandbox-resolver";
import { normalizeSetupWizardCompletedAt } from "./runtime-config-setup-wizard-resolver";
import type { RuntimeGlobalConfigFileShape, RuntimeProjectConfigFileShape } from "./runtime-config-types";
import {
	buildRuntimeGlobalConfigFilePayload,
	type RuntimeGlobalConfigFileWriteInput,
} from "./runtime-global-config-file-payload";

export async function readRuntimeConfigFile<T>(configPath: string): Promise<T | null> {
	let raw: string;
	try {
		raw = await readFile(configPath, "utf8");
	} catch (err) {
		// File does not exist (ENOENT) → normal first-run, return null silently.
		// Any other read error (e.g. permissions) is surfaced so the user is not silently surprised.
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
			process.stderr.write(`[!Klein] Failed to read config file at ${configPath}: ${err.message}\n`);
		}
		return null;
	}
	try {
		return JSON.parse(raw) as T;
	} catch (parseErr) {
		// File exists but is corrupt (unparseable JSON). Preserve the original bytes
		// in a timestamped backup so a subsequent save cannot silently overwrite them.
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const backupPath = `${configPath}.corrupt-${timestamp}.bak`;
		process.stderr.write(
			`[!Klein] Config file at ${configPath} could not be parsed and may be corrupt. ` +
				`Original file preserved at ${backupPath}. ` +
				`Error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n`,
		);
		try {
			await copyFile(configPath, backupPath);
		} catch (backupErr) {
			process.stderr.write(
				`[!Klein] Failed to create backup of corrupt config at ${backupPath}: ` +
					`${backupErr instanceof Error ? backupErr.message : String(backupErr)}\n`,
			);
		}
		return null;
	}
}

export async function writeRuntimeGlobalConfigFile(
	configPath: string,
	config: RuntimeGlobalConfigFileWriteInput,
): Promise<void> {
	const existing = await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(configPath);
	const payload = buildRuntimeGlobalConfigFilePayload(config, existing);
	await lockedFileSystem.writeJsonFileAtomic(configPath, payload, {
		lock: null,
	});
}

export async function writeRuntimeProjectConfigFile(
	configPath: string | null,
	config: {
		shortcuts: RuntimeProjectShortcut[];
		projectSetupWizardCompletedAt?: number | null;
		codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
		modelSuitabilityPolicyOverride?: RuntimeModelSuitabilityPolicy | null;
		skillDynamicsLevelOverride?: RuntimeSkillDynamicsLevel | null;
		fileOverlapParallelismOverride?: RuntimeFileOverlapParallelism | null;
		concurrencyOverride?: ConcurrencyOverride | null;
		maxConcurrentTasksOverride?: number | null;
		selectedAgentIdOverride?: RuntimeAgentId | null;
		agentRulesetsOverride?: AgentRulesetsConfigPayload | null;
		modelRolesOverride?: RuntimeModelRoles | null;
		sandboxIsolationProfileOverride?: RuntimeSandboxIsolationProfile | null;
		testDrivenModeOverride?: boolean | null;
	},
): Promise<void> {
	const normalizedShortcuts = normalizeShortcuts(config.shortcuts);
	const projectSetupWizardCompletedAt = normalizeSetupWizardCompletedAt(config.projectSetupWizardCompletedAt);
	const codeEmbeddingOverride = normalizeCodeEmbeddingOverride(config.codeEmbeddingOverride);
	const modelSuitabilityPolicyOverride = normalizeModelSuitabilityPolicyOverride(
		config.modelSuitabilityPolicyOverride,
	);
	const skillDynamicsLevelOverride = normalizeSkillDynamicsLevelOverride(config.skillDynamicsLevelOverride);
	const fileOverlapParallelismOverride = normalizeFileOverlapParallelismOverride(
		config.fileOverlapParallelismOverride,
	);
	const concurrencyOverride = normalizeConcurrencyOverride(config.concurrencyOverride);
	const maxConcurrentTasksOverride = normalizeMaxConcurrentTasksOverride(config.maxConcurrentTasksOverride);
	const selectedAgentIdOverride = normalizeSelectedAgentIdOverride(config.selectedAgentIdOverride);
	const agentRulesetsOverride = normalizeAgentRulesetsOverride(config.agentRulesetsOverride);
	const modelRolesOverride = normalizeModelRolesOverride(config.modelRolesOverride);
	const sandboxIsolationProfileOverride = normalizeRuntimeSandboxIsolationProfileOverride(
		config.sandboxIsolationProfileOverride,
	);
	const testDrivenModeOverride = normalizeTestDrivenModeOverride(config.testDrivenModeOverride);
	if (!configPath) {
		if (normalizedShortcuts.length > 0) {
			throw new Error("Cannot save project shortcuts without a selected project.");
		}
		if (codeEmbeddingOverride) {
			throw new Error("Cannot save project embedding overrides without a selected project.");
		}
		if (modelSuitabilityPolicyOverride) {
			throw new Error("Cannot save project model-suitability override without a selected project.");
		}
		if (skillDynamicsLevelOverride) {
			throw new Error("Cannot save project skill-dynamics override without a selected project.");
		}
		if (fileOverlapParallelismOverride) {
			throw new Error("Cannot save project file-overlap parallelism override without a selected project.");
		}
		if (projectSetupWizardCompletedAt !== null) {
			throw new Error("Cannot save project setup-wizard completion stamp without a selected project.");
		}
		if (maxConcurrentTasksOverride !== null) {
			throw new Error("Cannot save project concurrent task override without a selected project.");
		}
		if (selectedAgentIdOverride !== null) {
			throw new Error("Cannot save project agent override without a selected project.");
		}
		if (agentRulesetsOverride !== null) {
			throw new Error("Cannot save project agent rulesets override without a selected project.");
		}
		if (modelRolesOverride !== null) {
			throw new Error("Cannot save project model roles override without a selected project.");
		}
		if (sandboxIsolationProfileOverride !== null) {
			throw new Error("Cannot save project sandbox isolation override without a selected project.");
		}
		if (testDrivenModeOverride !== null) {
			throw new Error("Cannot save project test-driven override without a selected project.");
		}
		return;
	}
	if (
		normalizedShortcuts.length === 0 &&
		projectSetupWizardCompletedAt === null &&
		codeEmbeddingOverride === null &&
		modelSuitabilityPolicyOverride === null &&
		skillDynamicsLevelOverride === null &&
		fileOverlapParallelismOverride === null &&
		concurrencyOverride === null &&
		maxConcurrentTasksOverride === null &&
		selectedAgentIdOverride === null &&
		agentRulesetsOverride === null &&
		modelRolesOverride === null &&
		sandboxIsolationProfileOverride === null &&
		testDrivenModeOverride === null
	) {
		await rm(configPath, { force: true });
		try {
			await rm(dirname(configPath));
		} catch {
			// Ignore missing or non-empty project config directories.
		}
		return;
	}
	await lockedFileSystem.writeJsonFileAtomic(
		configPath,
		{
			shortcuts: normalizedShortcuts,
			...(projectSetupWizardCompletedAt !== null ? { projectSetupWizardCompletedAt } : {}),
			...(codeEmbeddingOverride ? { codeEmbeddingOverride } : {}),
			...(modelSuitabilityPolicyOverride ? { modelSuitabilityPolicyOverride } : {}),
			...(skillDynamicsLevelOverride ? { skillDynamicsLevelOverride } : {}),
			...(fileOverlapParallelismOverride ? { fileOverlapParallelismOverride } : {}),
			...(concurrencyOverride ? { concurrencyOverride } : {}),
			...(maxConcurrentTasksOverride !== null ? { maxConcurrentTasksOverride } : {}),
			...(selectedAgentIdOverride !== null ? { selectedAgentIdOverride } : {}),
			...(agentRulesetsOverride !== null ? { agentRulesetsOverride } : {}),
			...(modelRolesOverride !== null ? { modelRolesOverride } : {}),
			...(sandboxIsolationProfileOverride !== null ? { sandboxIsolationProfileOverride } : {}),
			...(testDrivenModeOverride !== null ? { testDrivenModeOverride } : {}),
		} satisfies RuntimeProjectConfigFileShape,
		{
			lock: null,
		},
	);
}
