import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRulesetRole } from "../core/agent-rulesets";
import {
	type CommunitySkillSuggestionCandidate,
	rankCommunitySkillSuggestions,
} from "../core/community-skill-suggestion";
import { getSkillPin } from "../state/skill-pin-store";
import { defaultCommunitySkillRoot, readVerifiedCommunitySkillSnapshot } from "./community-skill-snapshot";

const MAX_SNAPSHOTS = 512;

export interface CommunitySkillSuggestion {
	snapshotId: string;
	skillId: string;
	name: string;
	description: string;
	version: string | null;
	contentHash: string;
	sourceUrl: string;
	score: number;
	matchedTerms: string[];
	quarantinedData: true;
	humanApprovalRequired: true;
	promptEligible: false;
	active: false;
}

export interface CommunitySkillSuggestionResult {
	sessionId: string;
	role: AgentRulesetRole;
	channel: "suggest-only";
	suggestions: CommunitySkillSuggestion[];
}

export function createCommunitySkillSuggestionService(options: { rootDir?: string; pinRootDir?: string } = {}) {
	const rootDir = options.rootDir ?? defaultCommunitySkillRoot();
	return {
		suggest: async (request: {
			sessionId: string;
			role: AgentRulesetRole;
			taskText: string;
		}): Promise<CommunitySkillSuggestionResult> => {
			const importedDir = join(rootDir, "imported");
			const identities = await readdir(importedDir, { withFileTypes: true }).catch((error: unknown) => {
				if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
				throw error;
			});
			const candidates: CommunitySkillSuggestionCandidate[] = [];
			for (const identity of identities.sort((left, right) => left.name.localeCompare(right.name))) {
				if (!identity.isDirectory() || identity.isSymbolicLink() || !/^[a-f0-9]{32}$/u.test(identity.name))
					continue;
				const snapshots = await readdir(join(importedDir, identity.name), { withFileTypes: true });
				for (const entry of snapshots.sort((left, right) => left.name.localeCompare(right.name))) {
					if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) continue;
					if (candidates.length >= MAX_SNAPSHOTS) break;
					const snapshotId = `${identity.name}/${entry.name}`;
					const snapshot = await readVerifiedCommunitySkillSnapshot({ rootDir, snapshotId });
					const pin = await getSkillPin(snapshot.metadata.skillId, { rootDir: options.pinRootDir });
					if (
						!pin ||
						pin.contentHash !== snapshot.metadata.contentHash ||
						pin.version !== snapshot.metadata.version ||
						snapshot.loaded.disposition === "reject" ||
						snapshot.loaded.executionGate.posture === "blocked"
					) {
						continue;
					}
					candidates.push({
						snapshotId,
						skillId: snapshot.metadata.skillId,
						name: snapshot.loaded.manifest.name,
						description: snapshot.loaded.manifest.description,
						version: snapshot.metadata.version,
						contentHash: snapshot.metadata.contentHash,
						sourceUrl: snapshot.metadata.sourceUrl,
					});
				}
				if (candidates.length >= MAX_SNAPSHOTS) break;
			}
			return {
				sessionId: request.sessionId,
				role: request.role,
				channel: "suggest-only",
				suggestions: rankCommunitySkillSuggestions(request.taskText, candidates).map((suggestion) => ({
					...suggestion,
					quarantinedData: true,
					humanApprovalRequired: true,
					promptEligible: false,
					active: false,
				})),
			};
		},
	};
}
