/**
 * F4.22 user-controlled community-skill import.
 *
 * The inbox is the only mutable input. Review returns exact inert bytes plus every deterministic finding. Approval
 * reloads that inbox entry and compares its SHA-256 with the hash the user reviewed, then writes a content-addressed,
 * read-only snapshot before advancing the TOFU pin. Nothing here registers a skill or exposes its text to a model.
 */

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type {
	RuntimeCommunitySkillImportApproveRequest,
	RuntimeCommunitySkillImportApproveResponse,
	RuntimeCommunitySkillImportListResponse,
	RuntimeCommunitySkillImportReviewRequest,
	RuntimeCommunitySkillImportReviewResponse,
} from "../core/community-skill-import-api-contract";
import { buildCanonicalSkillBundlePreimage } from "../core/skill-bundle-canonical-preimage";
import { decideSkillImport } from "../core/skill-import-decision";
import { detectPinDrift } from "../core/skill-pin-drift";
import { classifySkillSourceTrust } from "../core/skill-source-trust";
import { lockedFileSystem } from "../fs/locked-file-system";
import {
	type LoadedCommunitySkillBundle,
	type LoadedCommunitySkillFile,
	loadCommunitySkillBundle,
} from "../nklein-agent/community-skill-bundle-loader";
import { getSkillPin, upsertSkillPin } from "../state/skill-pin-store";
import { readVerifiedCommunitySkillSnapshot } from "./community-skill-snapshot";

const MAX_INBOX_ENTRIES = 512;

export class CommunitySkillImportError extends Error {
	constructor(
		readonly code:
			| "candidate_rejected"
			| "content_changed"
			| "import_blocked"
			| "invalid_candidate"
			| "snapshot_conflict",
		message: string,
	) {
		super(message);
		this.name = "CommunitySkillImportError";
	}
}

export interface CommunitySkillImportServiceOptions {
	rootDir?: string;
	pinRootDir?: string;
	allowedToolBaseline?: readonly string[];
	now?: () => number;
}

export interface CommunitySkillImportService {
	listCandidates(): Promise<RuntimeCommunitySkillImportListResponse>;
	review(request: RuntimeCommunitySkillImportReviewRequest): Promise<RuntimeCommunitySkillImportReviewResponse>;
	approve(request: RuntimeCommunitySkillImportApproveRequest): Promise<RuntimeCommunitySkillImportApproveResponse>;
}

function defaultRoot(): string {
	return join(resolveNkleinRuntimeHomePath(homedir()), "community-skills");
}

function canonicalFiles(loaded: LoadedCommunitySkillBundle): LoadedCommunitySkillFile[] {
	return [loaded.sourceFile, ...loaded.files];
}

function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function contentHash(loaded: LoadedCommunitySkillBundle): string {
	return sha256(buildCanonicalSkillBundlePreimage(canonicalFiles(loaded)));
}

function textOrNull(content: Uint8Array): string | null {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(content);
	} catch {
		return null;
	}
}

function assertImmediateDirectory(directory: string): void {
	if (
		directory.length === 0 ||
		directory.length > 255 ||
		directory === "." ||
		directory === ".." ||
		directory.includes("/") ||
		directory.includes("\\") ||
		directory.includes("\0")
	) {
		throw new CommunitySkillImportError("invalid_candidate", "Select one immediate directory from the skill inbox.");
	}
}

async function pathExists(path: string): Promise<boolean> {
	return await lstat(path).then(
		() => true,
		(error: unknown) => {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
			throw error;
		},
	);
}

function snapshotConflict(): CommunitySkillImportError {
	return new CommunitySkillImportError(
		"snapshot_conflict",
		"The content-addressed import snapshot conflicts with the reviewed artifact.",
	);
}

async function verifyExistingSnapshot(
	rootDir: string,
	snapshotId: string,
	reviewed: RuntimeCommunitySkillImportReviewResponse,
): Promise<void> {
	try {
		const stored = await readVerifiedCommunitySkillSnapshot({ rootDir, snapshotId });
		if (stored.metadata.contentHash !== reviewed.contentHash || stored.metadata.skillId !== reviewed.skillId) {
			throw snapshotConflict();
		}
	} catch (error) {
		if (error instanceof CommunitySkillImportError) throw error;
		throw snapshotConflict();
	}
}

export function createCommunitySkillImportService(
	options: CommunitySkillImportServiceOptions = {},
): CommunitySkillImportService {
	const rootDir = options.rootDir ?? defaultRoot();
	const inboxDir = join(rootDir, "inbox");
	const importedDir = join(rootDir, "imported");
	const now = options.now ?? Date.now;

	const review = async (
		request: RuntimeCommunitySkillImportReviewRequest,
	): Promise<RuntimeCommunitySkillImportReviewResponse> => {
		assertImmediateDirectory(request.directory);
		await mkdir(inboxDir, { recursive: true, mode: 0o700 });
		const sourceUrl = request.sourceUrl.trim();
		const result = await loadCommunitySkillBundle({
			containmentRoot: inboxDir,
			skillDirectory: request.directory,
			allowedToolBaseline: options.allowedToolBaseline,
		});
		if (!result.ok) {
			throw new CommunitySkillImportError(
				"candidate_rejected",
				`The staged skill could not be reviewed (${result.error.code}): ${result.error.message}`,
			);
		}
		const loaded = result.loaded;
		const trust = classifySkillSourceTrust(sourceUrl);
		const hash = contentHash(loaded);
		const skillId = `${trust.origin}#${loaded.manifest.name}`;
		const priorPin = await getSkillPin(skillId, { rootDir: options.pinRootDir });
		const drift = detectPinDrift(priorPin, {
			contentHash: hash,
			version: loaded.manifest.version ?? null,
		});
		const decision = decideSkillImport({
			trust,
			prescreen: loaded.injectionScreen,
			bundled: loaded.bundledManifest,
			contentHash: hash,
			priorPin: priorPin
				? {
						skillId: priorPin.id,
						contentHash: priorPin.contentHash,
						pinnedAt: new Date(priorPin.pinnedAt).toISOString(),
					}
				: null,
		});
		return {
			inboxPath: inboxDir,
			directory: request.directory,
			sourceUrl,
			sourcePath: loaded.sourcePath,
			skillId,
			contentHash: hash,
			version: loaded.manifest.version ?? null,
			trust,
			manifest: loaded.manifest,
			sourceText: loaded.sourceText,
			files: canonicalFiles(loaded).map((file) => ({
				path: file.path,
				sizeBytes: file.sizeBytes,
				mode: file.mode & 0o7777,
				contentBase64: Buffer.from(file.content).toString("base64"),
				textContent: textOrNull(file.content),
			})),
			bundledManifest: loaded.bundledManifest,
			executableScreen: loaded.executableScreen,
			executionGate: loaded.executionGate,
			injectionScreen: loaded.injectionScreen,
			capabilityGrant: loaded.capabilityGrant,
			disposition: loaded.disposition,
			priorPin,
			drift,
			decision,
			channel: "user-review-only",
			promptEligible: false,
			active: false,
		};
	};

	return {
		listCandidates: async () => {
			await mkdir(inboxDir, { recursive: true, mode: 0o700 });
			const entries = await readdir(inboxDir, { withFileTypes: true });
			entries.sort((left, right) => left.name.localeCompare(right.name));
			return {
				inboxPath: inboxDir,
				truncated: entries.length > MAX_INBOX_ENTRIES,
				candidates: entries.slice(0, MAX_INBOX_ENTRIES).map((entry) => ({
					directory: entry.name,
					selectable: entry.isDirectory() && !entry.isSymbolicLink(),
					reason: entry.isDirectory() && !entry.isSymbolicLink() ? null : "Only real directories are selectable.",
				})),
			};
		},
		review,
		approve: async (request) =>
			await lockedFileSystem.withLock(
				{ type: "directory", path: rootDir, lockfileName: ".community-skill-import.lock" },
				async () => {
					if (request.confirmation !== true) {
						throw new CommunitySkillImportError("invalid_candidate", "Explicit import confirmation is required.");
					}
					const reviewed = await review(request);
					if (reviewed.contentHash !== request.expectedContentHash) {
						throw new CommunitySkillImportError(
							"content_changed",
							"The staged skill changed after review. Review the new bytes before importing.",
						);
					}
					if (reviewed.decision.decision === "reject" || reviewed.disposition === "reject") {
						throw new CommunitySkillImportError(
							"import_blocked",
							"This skill has reject-level findings and cannot be imported.",
						);
					}

					const importedAt = now();
					const identityHash = sha256(reviewed.skillId).slice(0, 32);
					const snapshotId = `${identityHash}/${reviewed.contentHash}`;
					const identityDir = join(importedDir, identityHash);
					const targetDir = join(identityDir, reviewed.contentHash);
					await mkdir(identityDir, { recursive: true, mode: 0o700 });
					if (await pathExists(targetDir)) {
						await verifyExistingSnapshot(rootDir, snapshotId, reviewed);
					} else {
						const tempDir = await mkdtemp(join(identityDir, `.tmp-${randomUUID()}-`));
						try {
							const contentDir = join(tempDir, "content");
							await mkdir(contentDir, { mode: 0o700 });
							for (const file of reviewed.files) {
								const destination = join(contentDir, ...file.path.split("/"));
								const parent = dirname(destination);
								await mkdir(parent, { recursive: true, mode: 0o700 });
								await writeFile(destination, Buffer.from(file.contentBase64, "base64"), {
									flag: "wx",
									mode: 0o400,
								});
							}
							const metadata = {
								format: "nklein-community-skill-import-v1",
								skillId: reviewed.skillId,
								contentHash: reviewed.contentHash,
								version: reviewed.version,
								sourceUrl: reviewed.sourceUrl,
								trust: reviewed.trust,
								manifest: reviewed.manifest,
								files: reviewed.files.map((file) => ({
									path: file.path,
									sizeBytes: file.sizeBytes,
									originalMode: file.mode,
									sha256: sha256(Buffer.from(file.contentBase64, "base64")),
								})),
								bundledManifest: reviewed.bundledManifest,
								executableScreen: reviewed.executableScreen,
								executionGate: reviewed.executionGate,
								injectionScreen: reviewed.injectionScreen,
								capabilityGrant: reviewed.capabilityGrant,
								decision: reviewed.decision,
								importedAt,
								active: false,
							};
							await writeFile(join(tempDir, "review.json"), `${JSON.stringify(metadata, null, 2)}\n`, {
								flag: "wx",
								mode: 0o400,
							});
							await rename(tempDir, targetDir);
						} catch (error) {
							await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
							throw error;
						}
					}

					await upsertSkillPin(
						{
							id: reviewed.skillId,
							contentHash: reviewed.contentHash,
							version: reviewed.version,
							trust: reviewed.trust.trust,
							pinnedAt: importedAt,
						},
						{ rootDir: options.pinRootDir },
					);
					return {
						skillId: reviewed.skillId,
						contentHash: reviewed.contentHash,
						snapshotId,
						importedAt,
						active: false,
						quarantined: true,
						decision: reviewed.decision,
					};
				},
			),
	};
}
