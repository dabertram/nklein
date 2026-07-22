import { constants } from "node:fs";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { RuntimeProjectInitializerBrief } from "../../core/api-contract.js";
import {
	assessProjectInitializerBrief,
	type ProjectInitializerBriefInput,
	renderCanonicalProjectBrief,
} from "../../core/project-initializer.js";
import { confineToAllowedRoots } from "../../workspace/remote-path-confinement.js";

const MAX_REFERENCE_FILE_BYTES = 200_000;
export const CANONICAL_PROJECT_BRIEF_FILE = "PROJECT_BRIEF.md";

export async function resolveProjectInitializerBrief(input: {
	brief: RuntimeProjectInitializerBrief;
	referenceBasePath: string;
	isRemoteMode: boolean;
	allowedBrowseRoots: readonly string[];
}): Promise<ProjectInitializerBriefInput> {
	const references: ProjectInitializerBriefInput["references"] = [];
	for (const reference of input.brief.references) {
		if (reference.kind !== "file") {
			references.push(reference);
			continue;
		}
		const referencePath = isAbsolute(reference.value)
			? resolve(reference.value)
			: resolve(input.referenceBasePath, reference.value);
		if (input.isRemoteMode) {
			const confinement = confineToAllowedRoots(referencePath, input.allowedBrowseRoots);
			if (!confinement.allowed) {
				throw new Error(`Reference file is outside the allowed remote directories: ${reference.value}`);
			}
		}
		const pathInfo = await lstat(referencePath);
		if (!pathInfo.isFile()) throw new Error(`Reference is not a regular non-symlink file: ${reference.value}`);
		const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
		const handle = await open(referencePath, constants.O_RDONLY | noFollow);
		let content: string;
		try {
			const info = await handle.stat();
			if (!info.isFile()) throw new Error(`Reference is not a regular file: ${reference.value}`);
			if (info.dev !== pathInfo.dev || info.ino !== pathInfo.ino) {
				throw new Error(`Reference file changed while it was being opened: ${reference.value}`);
			}
			if (input.isRemoteMode) {
				const canonicalPath = await realpath(referencePath);
				const confinement = confineToAllowedRoots(canonicalPath, input.allowedBrowseRoots);
				if (!confinement.allowed) {
					throw new Error(`Reference file resolves outside the allowed remote directories: ${reference.value}`);
				}
			}
			if (info.size > MAX_REFERENCE_FILE_BYTES) {
				throw new Error(
					`Reference file exceeds the ${MAX_REFERENCE_FILE_BYTES} byte intake limit: ${reference.value}`,
				);
			}
			content = await handle.readFile({ encoding: "utf8" });
		} finally {
			await handle.close();
		}
		if (content.includes("\0")) throw new Error(`Reference file is not plain text: ${reference.value}`);
		references.push({ ...reference, label: reference.label || referencePath, content });
	}
	const brief: ProjectInitializerBriefInput = { ...input.brief, references };
	const readiness = assessProjectInitializerBrief(brief);
	if (!readiness.ready) {
		throw new Error(`Project brief is not ready: ${readiness.blockingGaps.join(" ")}`);
	}
	return brief;
}

export async function writeCanonicalProjectBrief(input: {
	projectPath: string;
	projectName: string;
	brief: ProjectInitializerBriefInput;
}): Promise<string> {
	const briefPath = join(input.projectPath, CANONICAL_PROJECT_BRIEF_FILE);
	await writeFile(briefPath, renderCanonicalProjectBrief({ projectName: input.projectName, brief: input.brief }), {
		encoding: "utf8",
		flag: "wx",
	});
	return briefPath;
}
