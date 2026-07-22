/**
 * F4.23 effectful activation boundary for imported community skills.
 *
 * Preview and approval both reload the immutable snapshot and recompute the complete containment envelope. Approval is
 * bound to the reviewed content hash AND a policy hash, closing configuration/tool/approval TOCTOU. The durable ticket
 * is session-specific and contains no skill text or credential values; F4.26 may consume it to admit the exact snapshot
 * into one execution context.
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRulesetRole, SandboxNetworkPolicy } from "../core/agent-rulesets";
import {
	type CommunitySkillAvailableTool,
	type CommunitySkillExecutableApproval,
	type CommunitySkillSessionContainmentResult,
	decideCommunitySkillSessionContainment,
} from "../core/community-skill-session-containment";
import { gateSkillBundleExecution } from "../core/skill-execution-gate";
import { lockedFileSystem } from "../fs/locked-file-system";
import { getSkillPin } from "../state/skill-pin-store";
import {
	defaultCommunitySkillRoot,
	readVerifiedCommunitySkillSnapshot,
	sha256CommunitySkillBytes,
} from "./community-skill-snapshot";

export interface CommunitySkillExecutionEnvironment {
	availableTools: readonly CommunitySkillAvailableTool[];
	requestedNetworkPolicy: SandboxNetworkPolicy;
	dockerSandbox: boolean;
	sensitiveAccess: boolean;
	ambientCredentialNames?: readonly string[];
	taskScopedEgressIdentity: boolean;
}

export interface CommunitySkillExecutionReviewRequest {
	snapshotId: string;
	sessionId: string;
	role: AgentRulesetRole;
	requestedExecutablePaths?: readonly string[];
	executableApprovals?: readonly CommunitySkillExecutableApproval[];
	environment: CommunitySkillExecutionEnvironment;
}

export interface CommunitySkillExecutionReview {
	snapshotId: string;
	skillId: string;
	contentHash: string;
	version: string | null;
	sessionId: string;
	role: AgentRulesetRole;
	policyHash: string;
	containment: CommunitySkillSessionContainmentResult;
	promptEligible: boolean;
	active: false;
}

export interface CommunitySkillExecutionApproveRequest extends CommunitySkillExecutionReviewRequest {
	expectedContentHash: string;
	expectedPolicyHash: string;
	confirmation: true;
}

export interface CommunitySkillActivationTicket extends Omit<CommunitySkillExecutionReview, "active"> {
	activationId: string;
	approvedAt: number;
	active: true;
}

export class CommunitySkillExecutionError extends Error {
	constructor(
		readonly code: "activation_blocked" | "content_changed" | "invalid_request" | "pin_mismatch" | "policy_changed",
		message: string,
	) {
		super(message);
		this.name = "CommunitySkillExecutionError";
	}
}

export interface CommunitySkillExecutionServiceOptions {
	rootDir?: string;
	pinRootDir?: string;
	now?: () => number;
}

function validateSessionValue(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 255 || trimmed.includes("\0")) {
		throw new CommunitySkillExecutionError("invalid_request", `${label} must be a non-empty bounded identifier.`);
	}
	return trimmed;
}

function stablePolicyHash(value: Omit<CommunitySkillExecutionReview, "policyHash">): string {
	return sha256CommunitySkillBytes(
		JSON.stringify({
			format: "nklein-community-skill-execution-policy-v1",
			snapshotId: value.snapshotId,
			skillId: value.skillId,
			contentHash: value.contentHash,
			version: value.version,
			sessionId: value.sessionId,
			role: value.role,
			containment: value.containment,
			promptEligible: value.promptEligible,
			active: false,
		}),
	);
}

const ACTIVATION_TICKET_KEYS = [
	"snapshotId",
	"skillId",
	"contentHash",
	"version",
	"sessionId",
	"role",
	"policyHash",
	"containment",
	"promptEligible",
	"activationId",
	"approvedAt",
	"active",
] as const;

async function readExistingTicket(
	target: string,
	reviewed: CommunitySkillExecutionReview,
	activationId: string,
): Promise<CommunitySkillActivationTicket> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size > 1024 * 1024) {
			throw new CommunitySkillExecutionError("policy_changed", "The existing activation ticket is not immutable.");
		}
		const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") throw new Error("invalid ticket");
		const record = parsed as Record<string, unknown>;
		if (
			Object.keys(record).sort().join("\0") !== [...ACTIVATION_TICKET_KEYS].sort().join("\0") ||
			record.activationId !== activationId ||
			record.policyHash !== reviewed.policyHash ||
			record.active !== true ||
			typeof record.approvedAt !== "number" ||
			!Number.isSafeInteger(record.approvedAt) ||
			record.approvedAt < 0
		) {
			throw new Error("invalid ticket");
		}
		const existingPolicy: Omit<CommunitySkillExecutionReview, "policyHash"> = {
			snapshotId: String(record.snapshotId),
			skillId: String(record.skillId),
			contentHash: String(record.contentHash),
			version: record.version === null ? null : String(record.version),
			sessionId: String(record.sessionId),
			role: String(record.role) as AgentRulesetRole,
			containment: record.containment as CommunitySkillSessionContainmentResult,
			promptEligible: record.promptEligible === true,
			active: false,
		};
		if (stablePolicyHash(existingPolicy) !== reviewed.policyHash) throw new Error("invalid ticket");
		return record as unknown as CommunitySkillActivationTicket;
	} catch (error) {
		if (error instanceof CommunitySkillExecutionError) throw error;
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw error;
		throw new CommunitySkillExecutionError(
			"policy_changed",
			"The existing session activation ticket conflicts with the reviewed policy.",
		);
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

export function createCommunitySkillExecutionService(options: CommunitySkillExecutionServiceOptions = {}) {
	const rootDir = options.rootDir ?? defaultCommunitySkillRoot();
	const now = options.now ?? Date.now;

	const review = async (request: CommunitySkillExecutionReviewRequest): Promise<CommunitySkillExecutionReview> => {
		const sessionId = validateSessionValue(request.sessionId, "Session id");
		const role = validateSessionValue(request.role, "Role") as AgentRulesetRole;
		const snapshot = await readVerifiedCommunitySkillSnapshot({ rootDir, snapshotId: request.snapshotId });
		const pin = await getSkillPin(snapshot.metadata.skillId, { rootDir: options.pinRootDir });
		if (!pin || pin.contentHash !== snapshot.metadata.contentHash || pin.version !== snapshot.metadata.version) {
			throw new CommunitySkillExecutionError(
				"pin_mismatch",
				"The imported snapshot is not the currently approved TOFU pin. Review and pin it again before activation.",
			);
		}
		const executionGate = gateSkillBundleExecution(
			snapshot.loaded.bundledManifest.entries,
			snapshot.loaded.executableScreen,
		);
		const fileHashByPath = new Map(snapshot.metadata.files.map((file) => [file.path, file.sha256]));
		const executableFiles = executionGate.approvalRequired.flatMap((entry) => {
			const path = entry.normalizedPath ?? entry.rawPath;
			const sha256 = fileHashByPath.get(path);
			return sha256 ? [{ path, sha256 }] : [];
		});
		const containment = decideCommunitySkillSessionContainment({
			manifest: snapshot.loaded.manifest,
			executionGate,
			executableFiles,
			requestedExecutablePaths: request.requestedExecutablePaths,
			executableApprovals: request.executableApprovals,
			...request.environment,
		});
		const base: Omit<CommunitySkillExecutionReview, "policyHash"> = {
			snapshotId: request.snapshotId,
			skillId: snapshot.metadata.skillId,
			contentHash: snapshot.metadata.contentHash,
			version: snapshot.metadata.version,
			sessionId,
			role,
			containment,
			promptEligible: containment.decision === "allow",
			active: false,
		};
		return { ...base, policyHash: stablePolicyHash(base) };
	};

	return {
		review,
		approve: async (request: CommunitySkillExecutionApproveRequest): Promise<CommunitySkillActivationTicket> =>
			await lockedFileSystem.withLock(
				{ type: "directory", path: rootDir, lockfileName: ".community-skill-execution.lock" },
				async () => {
					if (request.confirmation !== true) {
						throw new CommunitySkillExecutionError(
							"invalid_request",
							"Explicit activation confirmation is required.",
						);
					}
					const reviewed = await review(request);
					if (reviewed.contentHash !== request.expectedContentHash) {
						throw new CommunitySkillExecutionError(
							"content_changed",
							"The imported snapshot changed after execution review. Review the current bytes again.",
						);
					}
					if (reviewed.policyHash !== request.expectedPolicyHash) {
						throw new CommunitySkillExecutionError(
							"policy_changed",
							"The session containment policy changed after review. Review the effective tools and constraints again.",
						);
					}
					if (!reviewed.promptEligible || reviewed.containment.decision !== "allow") {
						throw new CommunitySkillExecutionError("activation_blocked", reviewed.containment.reason);
					}
					const activationId = sha256CommunitySkillBytes(
						`${reviewed.sessionId}\0${reviewed.snapshotId}\0${reviewed.policyHash}`,
					);
					const sessionDirectory = join(rootDir, "activations", sha256CommunitySkillBytes(reviewed.sessionId));
					await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
					const target = join(sessionDirectory, `${activationId}.json`);
					try {
						return await readExistingTicket(target, reviewed, activationId);
					} catch (error) {
						if (error instanceof CommunitySkillExecutionError) throw error;
						if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
						const ticket: CommunitySkillActivationTicket = {
							...reviewed,
							activationId,
							approvedAt: now(),
							active: true,
						};
						const rendered = `${JSON.stringify(ticket, null, 2)}\n`;
						const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
						try {
							await writeFile(temporary, rendered, { flag: "wx", mode: 0o400 });
							await rename(temporary, target);
						} catch (writeError) {
							await rm(temporary, { force: true }).catch(() => undefined);
							throw writeError;
						}
						return ticket;
					}
				},
			),
	};
}
