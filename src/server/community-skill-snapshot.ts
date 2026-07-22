/** Shared verifier for F4.22 imported community-skill snapshots and F4.23 activation. */

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { buildCanonicalSkillBundlePreimage } from "../core/skill-bundle-canonical-preimage";
import {
	type LoadedCommunitySkillBundle,
	type LoadedCommunitySkillFile,
	loadCommunitySkillBundle,
} from "../nklein-agent/community-skill-bundle-loader";

const MAX_REVIEW_METADATA_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_ID = /^([a-f0-9]{32})\/([a-f0-9]{64})$/u;

export interface CommunitySkillSnapshotMetadataFile {
	path: string;
	sizeBytes: number;
	originalMode: number;
	sha256: string;
}

export interface CommunitySkillSnapshotMetadata {
	format: "nklein-community-skill-import-v1";
	skillId: string;
	contentHash: string;
	version: string | null;
	sourceUrl: string;
	files: CommunitySkillSnapshotMetadataFile[];
	active: false;
	[key: string]: unknown;
}

export interface VerifiedCommunitySkillSnapshot {
	snapshotId: string;
	targetDir: string;
	metadata: CommunitySkillSnapshotMetadata;
	loaded: LoadedCommunitySkillBundle;
	files: LoadedCommunitySkillFile[];
}

export class CommunitySkillSnapshotError extends Error {
	constructor(
		readonly code: "invalid_snapshot" | "snapshot_conflict",
		message: string,
	) {
		super(message);
		this.name = "CommunitySkillSnapshotError";
	}
}

export function defaultCommunitySkillRoot(): string {
	return join(resolveNkleinRuntimeHomePath(homedir()), "community-skills");
}

export function canonicalCommunitySkillFiles(loaded: LoadedCommunitySkillBundle): LoadedCommunitySkillFile[] {
	return [loaded.sourceFile, ...loaded.files];
}

export function sha256CommunitySkillBytes(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function communitySkillContentHash(loaded: LoadedCommunitySkillBundle): string {
	return sha256CommunitySkillBytes(buildCanonicalSkillBundlePreimage(canonicalCommunitySkillFiles(loaded)));
}

function conflict(message = "The imported community-skill snapshot no longer matches its reviewed bytes.") {
	return new CommunitySkillSnapshotError("snapshot_conflict", message);
}

function parseMetadata(value: unknown): CommunitySkillSnapshotMetadata {
	if (!value || typeof value !== "object") throw conflict();
	const record = value as Record<string, unknown>;
	if (
		record.format !== "nklein-community-skill-import-v1" ||
		typeof record.skillId !== "string" ||
		!record.skillId ||
		typeof record.contentHash !== "string" ||
		!/^[a-f0-9]{64}$/u.test(record.contentHash) ||
		!(record.version === null || typeof record.version === "string") ||
		typeof record.sourceUrl !== "string" ||
		record.active !== false ||
		!Array.isArray(record.files)
	) {
		throw conflict();
	}
	const seen = new Set<string>();
	const files = record.files.map((item): CommunitySkillSnapshotMetadataFile => {
		if (!item || typeof item !== "object") throw conflict();
		const file = item as Record<string, unknown>;
		if (
			typeof file.path !== "string" ||
			!file.path ||
			seen.has(file.path) ||
			typeof file.sizeBytes !== "number" ||
			!Number.isSafeInteger(file.sizeBytes) ||
			file.sizeBytes < 0 ||
			typeof file.originalMode !== "number" ||
			!Number.isSafeInteger(file.originalMode) ||
			typeof file.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/u.test(file.sha256)
		) {
			throw conflict();
		}
		seen.add(file.path);
		return {
			path: file.path,
			sizeBytes: file.sizeBytes,
			originalMode: file.originalMode,
			sha256: file.sha256,
		};
	});
	return { ...record, files } as CommunitySkillSnapshotMetadata;
}

/** Reload and cryptographically verify one immutable imported snapshot from disk. */
export async function readVerifiedCommunitySkillSnapshot(input: {
	rootDir?: string;
	snapshotId: string;
}): Promise<VerifiedCommunitySkillSnapshot> {
	const match = SNAPSHOT_ID.exec(input.snapshotId);
	if (!match) {
		throw new CommunitySkillSnapshotError(
			"invalid_snapshot",
			"A snapshot id must be its 32-hex identity directory and 64-hex content hash.",
		);
	}
	const identityHash = match[1];
	const pathContentHash = match[2];
	if (!identityHash || !pathContentHash) {
		throw new CommunitySkillSnapshotError("invalid_snapshot", "The snapshot id is incomplete.");
	}
	const targetDir = join(input.rootDir ?? defaultCommunitySkillRoot(), "imported", identityHash, pathContentHash);
	try {
		const metadataPath = join(targetDir, "review.json");
		const metadataStat = await lstat(metadataPath);
		if (!metadataStat.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > MAX_REVIEW_METADATA_BYTES) {
			throw conflict();
		}
		const metadata = parseMetadata(JSON.parse(await readFile(metadataPath, "utf8")) as unknown);
		if (
			metadata.contentHash !== pathContentHash ||
			sha256CommunitySkillBytes(metadata.skillId).slice(0, 32) !== identityHash
		) {
			throw conflict();
		}
		const loadedResult = await loadCommunitySkillBundle({ containmentRoot: targetDir, skillDirectory: "content" });
		if (!loadedResult.ok) throw conflict();
		const files = canonicalCommunitySkillFiles(loadedResult.loaded);
		if (files.length !== metadata.files.length) throw conflict();
		const metadataByPath = new Map(metadata.files.map((file) => [file.path, file]));
		const reconstructed = files.map((file) => {
			const recorded = metadataByPath.get(file.path);
			if (
				!recorded ||
				recorded.sizeBytes !== file.sizeBytes ||
				recorded.sha256 !== sha256CommunitySkillBytes(file.content) ||
				(file.mode & 0o777) !== 0o400
			) {
				throw conflict();
			}
			return { path: file.path, mode: recorded.originalMode, content: file.content };
		});
		if (sha256CommunitySkillBytes(buildCanonicalSkillBundlePreimage(reconstructed)) !== metadata.contentHash) {
			throw conflict();
		}
		return { snapshotId: input.snapshotId, targetDir, metadata, loaded: loadedResult.loaded, files };
	} catch (error) {
		if (error instanceof CommunitySkillSnapshotError) throw error;
		throw conflict();
	}
}
