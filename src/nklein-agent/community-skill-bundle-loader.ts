/**
 * F4.20 effectful community SKILL.md loader.
 *
 * Reads one real skill directory inside an explicit containment root, without importing, evaluating, spawning, or
 * otherwise executing any bundled file. The effectful boundary is deliberately narrow: bounded filesystem reads feed
 * the existing pure parser, bundle-manifest validator, executable screen, injection prescreen, and least-privilege
 * grant reconciler. A successful read produces an inert {@link DynamicSkill}; import approval and activation remain
 * later gates (F4.22/F4.23).
 */

import { constants, type Dirent, type Stats } from "node:fs";
import { type FileHandle, lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { type BundleScreenResult, screenBundleForExecutables } from "../core/skill-bundle-screening.js";
import {
	type BundledFileEntry,
	type BundledManifestResult,
	DEFAULT_MAX_FILE_BYTES,
	validateBundledFileManifest,
} from "../core/skill-bundled-file-manifest.js";
import { reconcileSkillCapabilityGrant, type SkillCapabilityGrant } from "../core/skill-capability-grant-reconcile.js";
import { prescreenSkillInjection, type SkillScreenResult } from "../core/skill-injection-prescreen.js";
import { type ParsedSkillManifest, parseSkillMd, type SkillParseError } from "../core/skill-md-parse.js";
import type { DynamicSkill } from "../core/skill-registry.js";
import { assertRealToolPathWithinRoot, confineToolPath } from "./nklein-tool-path-containment.js";

const DEFAULT_MAX_SKILL_MD_BYTES = 256 * 1024;
const DEFAULT_MAX_BUNDLE_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_BUNDLE_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_DEPTH = 8;
const SCREEN_HEAD_BYTES = 512;

export type CommunitySkillLoadErrorCode =
	| "invalid_path"
	| "not_found"
	| "not_directory"
	| "missing_skill_md"
	| "symlink_not_allowed"
	| "unsupported_file_type"
	| "containment_escape"
	| "limit_exceeded"
	| "invalid_utf8"
	| "parse_rejected"
	| "io_error";

export interface CommunitySkillLoadError {
	code: CommunitySkillLoadErrorCode;
	message: string;
	parseErrors?: SkillParseError[];
}

export interface LoadedCommunitySkillFile {
	/** Path relative to the skill root; never a host-absolute path. */
	path: string;
	sizeBytes: number;
	mode: number;
	/** Inert bytes retained for review and later content hashing. Never interpreted or executed by this loader. */
	content: Uint8Array;
}

export type CommunitySkillLoadDisposition = "candidate" | "quarantine" | "reject";

export interface LoadedCommunitySkillBundle {
	/** Registry-compatible but not registered or active. */
	dynamicSkill: DynamicSkill;
	manifest: ParsedSkillManifest;
	body: string;
	/** Exact SKILL.md text for the future full-source review UI. */
	sourceText: string;
	/** Exact raw SKILL.md bytes and original mode; part of the canonical TOFU pre-image. */
	sourceFile: LoadedCommunitySkillFile;
	/** Containment-root-relative source location; never leaks an absolute host path. */
	sourcePath: string;
	files: LoadedCommunitySkillFile[];
	bundledManifest: BundledManifestResult;
	executableScreen: BundleScreenResult;
	injectionScreen: SkillScreenResult;
	capabilityGrant: SkillCapabilityGrant;
	/** Loader posture only. `candidate` still requires the F4.22 user-controlled import gate before activation. */
	disposition: CommunitySkillLoadDisposition;
}

export type CommunitySkillLoadResult =
	| { ok: true; loaded: LoadedCommunitySkillBundle }
	| { ok: false; error: CommunitySkillLoadError };

export interface LoadCommunitySkillBundleOptions {
	/** Directory under which every candidate skill must physically reside. */
	containmentRoot: string;
	/** Skill directory, relative to containmentRoot (or an in-root absolute path). */
	skillDirectory: string;
	/** Host §5.L ceiling. Omitted means deny-all, never allow-all. */
	allowedToolBaseline?: readonly string[];
	maxSkillMdBytes?: number;
	maxBundleFileBytes?: number;
	maxBundleBytes?: number;
	maxEntries?: number;
	maxDepth?: number;
}

class LoadFailure extends Error {
	constructor(
		readonly code: CommunitySkillLoadErrorCode,
		message: string,
		readonly parseErrors?: SkillParseError[],
	) {
		super(message);
	}
}

function positiveLimit(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function keywordsFor(manifest: ParsedSkillManifest): string[] {
	const tokens = `${manifest.name} ${manifest.description}`.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
	return Array.from(new Set(tokens)).slice(0, 32);
}

function errorCode(error: unknown, missingCode: CommunitySkillLoadErrorCode): CommunitySkillLoadErrorCode {
	if (error && typeof error === "object" && "code" in error) {
		const code = String(error.code);
		if (code === "ENOENT") {
			return missingCode;
		}
		if (code === "ELOOP") {
			return "symlink_not_allowed";
		}
	}
	return "io_error";
}

async function readBoundedRegularFile(
	absolutePath: string,
	displayPath: string,
	maxBytes: number,
): Promise<{ content: Uint8Array; sizeBytes: number; mode: number }> {
	let handle: FileHandle | undefined;
	try {
		// O_NOFOLLOW closes the final-component symlink race between enumeration and open. Parent directories are checked
		// independently during the walk and again through realpath containment.
		handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
		const stat = await handle.stat();
		if (!stat.isFile()) {
			throw new LoadFailure("unsupported_file_type", `Only regular files may be loaded: ${displayPath}`);
		}
		if (stat.size > maxBytes) {
			throw new LoadFailure("limit_exceeded", `File exceeds the ${maxBytes}-byte loader limit: ${displayPath}`);
		}
		const buffer = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < buffer.length) {
			const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
			if (bytesRead === 0) {
				break;
			}
			offset += bytesRead;
		}
		if (offset !== stat.size) {
			throw new LoadFailure("io_error", `File changed while it was being read: ${displayPath}`);
		}
		const [finalHandleStat, finalPathStat] = await Promise.all([handle.stat(), lstat(absolutePath)]);
		if (
			finalHandleStat.dev !== stat.dev ||
			finalHandleStat.ino !== stat.ino ||
			finalHandleStat.size !== stat.size ||
			finalHandleStat.mtimeMs !== stat.mtimeMs ||
			finalPathStat.isSymbolicLink() ||
			finalPathStat.dev !== stat.dev ||
			finalPathStat.ino !== stat.ino
		) {
			throw new LoadFailure("io_error", `File changed while it was being read: ${displayPath}`);
		}
		return { content: buffer, sizeBytes: stat.size, mode: stat.mode };
	} catch (error) {
		if (error instanceof LoadFailure) {
			throw error;
		}
		throw new LoadFailure(errorCode(error, "not_found"), `Unable to read contained file: ${displayPath}`);
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function assertContainedExistingPath(root: string, absolutePath: string, relativePath: string): Promise<void> {
	const real = await assertRealToolPathWithinRoot(root, absolutePath, relativePath);
	if (!real.ok) {
		throw new LoadFailure("containment_escape", real.message);
	}
}

function dispositionFor(
	bundledManifest: BundledManifestResult,
	executableScreen: BundleScreenResult,
	injectionScreen: SkillScreenResult,
): CommunitySkillLoadDisposition {
	if (bundledManifest.verdict === "reject" || injectionScreen.verdict === "reject") {
		return "reject";
	}
	if (
		bundledManifest.verdict === "review" ||
		injectionScreen.verdict === "review" ||
		executableScreen.verdict === "quarantine"
	) {
		return "quarantine";
	}
	return "candidate";
}

/**
 * Load, contain, parse, and screen one real community skill bundle. This function has no execution dependency by
 * construction: every bundled file is handled only as bounded inert bytes.
 */
export async function loadCommunitySkillBundle(
	options: LoadCommunitySkillBundleOptions,
): Promise<CommunitySkillLoadResult> {
	const maxSkillMdBytes = positiveLimit(options.maxSkillMdBytes, DEFAULT_MAX_SKILL_MD_BYTES);
	const maxBundleFileBytes = positiveLimit(options.maxBundleFileBytes, DEFAULT_MAX_BUNDLE_FILE_BYTES);
	const maxBundleBytes = positiveLimit(options.maxBundleBytes, DEFAULT_MAX_BUNDLE_BYTES);
	const maxEntries = positiveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
	const maxDepth = positiveLimit(options.maxDepth, DEFAULT_MAX_DEPTH);

	try {
		const confined = confineToolPath(options.containmentRoot, options.skillDirectory);
		if (!confined.ok) {
			return { ok: false, error: { code: "invalid_path", message: confined.message } };
		}
		await assertContainedExistingPath(confined.matchedRoot, confined.absolutePath, confined.relativePath);

		let rootStat: Stats;
		try {
			rootStat = await lstat(confined.absolutePath);
		} catch (error) {
			throw new LoadFailure(errorCode(error, "not_found"), "Skill directory does not exist inside containment.");
		}
		if (rootStat.isSymbolicLink()) {
			throw new LoadFailure("symlink_not_allowed", "The skill directory may not be a symbolic link.");
		}
		if (!rootStat.isDirectory()) {
			throw new LoadFailure("not_directory", "The requested skill path is not a directory.");
		}

		const skillMdPath = join(confined.absolutePath, "SKILL.md");
		await assertContainedExistingPath(confined.absolutePath, skillMdPath, "SKILL.md");
		const skillMd = await readBoundedRegularFile(skillMdPath, "SKILL.md", maxSkillMdBytes).catch((error) => {
			if (error instanceof LoadFailure && error.code === "not_found") {
				throw new LoadFailure("missing_skill_md", "The contained skill directory has no SKILL.md file.");
			}
			throw error;
		});

		let sourceText: string;
		try {
			sourceText = new TextDecoder("utf-8", { fatal: true }).decode(skillMd.content);
		} catch {
			throw new LoadFailure("invalid_utf8", "SKILL.md must be valid UTF-8 text.");
		}
		const parsed = parseSkillMd(sourceText);
		if (!parsed.ok) {
			throw new LoadFailure("parse_rejected", "SKILL.md failed structural validation.", parsed.errors);
		}

		const files: LoadedCommunitySkillFile[] = [];
		let visitedEntries = 0;
		let aggregateBytes = 0;
		const walk = async (absoluteDirectory: string, relativeDirectory: string, depth: number): Promise<void> => {
			let entries: Dirent[];
			try {
				entries = await readdir(absoluteDirectory, { withFileTypes: true });
			} catch {
				throw new LoadFailure(
					"io_error",
					`Unable to enumerate contained bundle directory: ${relativeDirectory || "."}`,
				);
			}
			entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
			for (const entry of entries) {
				const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
				if (relativePath === "SKILL.md") {
					continue;
				}
				visitedEntries += 1;
				if (visitedEntries > maxEntries) {
					throw new LoadFailure("limit_exceeded", `Skill bundle exceeds the ${maxEntries}-entry traversal limit.`);
				}
				const child = confineToolPath(confined.absolutePath, relativePath);
				if (!child.ok) {
					throw new LoadFailure("containment_escape", child.message);
				}
				await assertContainedExistingPath(child.matchedRoot, child.absolutePath, relativePath);
				const childStat = await lstat(child.absolutePath).catch((error) => {
					throw new LoadFailure(errorCode(error, "not_found"), `Bundle entry disappeared: ${relativePath}`);
				});
				if (childStat.isSymbolicLink()) {
					throw new LoadFailure(
						"symlink_not_allowed",
						`Symbolic links are not allowed in a skill bundle: ${relativePath}`,
					);
				}
				if (childStat.isDirectory()) {
					if (depth >= maxDepth) {
						throw new LoadFailure("limit_exceeded", `Skill bundle exceeds the ${maxDepth}-level depth limit.`);
					}
					await walk(child.absolutePath, relativePath, depth + 1);
					continue;
				}
				if (!childStat.isFile()) {
					throw new LoadFailure("unsupported_file_type", `Only regular files may be loaded: ${relativePath}`);
				}
				const loaded = await readBoundedRegularFile(child.absolutePath, relativePath, maxBundleFileBytes);
				aggregateBytes += loaded.sizeBytes;
				if (aggregateBytes > maxBundleBytes) {
					throw new LoadFailure(
						"limit_exceeded",
						`Skill bundle exceeds the ${maxBundleBytes}-byte aggregate limit.`,
					);
				}
				files.push({ path: relativePath, ...loaded });
			}
		};
		await walk(confined.absolutePath, "", 0);

		const manifestEntries: BundledFileEntry[] = files.map((file) => ({
			path: file.path,
			sizeBytes: file.sizeBytes,
			mode: file.mode,
		}));
		const bundledManifest = validateBundledFileManifest(manifestEntries, {
			maxFileBytes: Math.min(DEFAULT_MAX_FILE_BYTES, maxBundleFileBytes),
		});
		const executableScreen = screenBundleForExecutables(
			files.map((file) => ({
				path: file.path,
				head: Buffer.from(file.content.buffer, file.content.byteOffset, file.content.byteLength)
					.subarray(0, SCREEN_HEAD_BYTES)
					.toString("latin1"),
			})),
		);
		const allowedToolBaseline = options.allowedToolBaseline ?? [];
		const injectionScreen = prescreenSkillInjection(parsed.manifest, parsed.body, { allowedToolBaseline });
		const capabilityGrant = reconcileSkillCapabilityGrant(parsed.manifest, allowedToolBaseline);
		const trimmedBody = parsed.body.trim();
		const dynamicSkill: DynamicSkill = {
			id: parsed.manifest.name,
			description: parsed.manifest.description,
			defaultRoles: [],
			contextFragments: [],
			tools: capabilityGrant.effectiveTools,
			...(trimmedBody ? { preamble: trimmedBody } : {}),
			keywords: keywordsFor(parsed.manifest),
		};

		return {
			ok: true,
			loaded: {
				dynamicSkill,
				manifest: parsed.manifest,
				body: parsed.body,
				sourceText,
				sourceFile: { path: "SKILL.md", ...skillMd },
				sourcePath: confined.relativePath === "." ? "SKILL.md" : `${confined.relativePath}/SKILL.md`,
				files,
				bundledManifest,
				executableScreen,
				injectionScreen,
				capabilityGrant,
				disposition: dispositionFor(bundledManifest, executableScreen, injectionScreen),
			},
		};
	} catch (error) {
		if (error instanceof LoadFailure) {
			return {
				ok: false,
				error: {
					code: error.code,
					message: error.message,
					...(error.parseErrors ? { parseErrors: error.parseErrors } : {}),
				},
			};
		}
		return { ok: false, error: { code: "io_error", message: "Unable to load the contained skill bundle." } };
	}
}
