import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F12.104 — the LOCAL-RETRIEVAL PRIVACY GUARANTEE as a machine-checked invariant: the retrieval index and code
 * embeddings never leave the machine. "Private by architecture, not by policy" only holds if a code change that adds
 * an egress edge to these modules FAILS CI. This test statically scans every retrieval/embedding module for remote
 * URLs; only localhost forms and the explicitly-allowlisted MODEL-DOWNLOAD url (ingress — fetching public weights,
 * never sending workspace data) may appear. Adding any other remote URL here must be a deliberate, reviewed act that
 * also updates this invariant.
 */

const MODULE_DIR = join(__dirname, "..", "..", "..", "src", "nklein-agent");
const PRIVACY_SCOPED_PATTERN = /retrieval|embed/i;

/** Ingress-only allowlist: public model weights download. NEVER add a data-egress endpoint here. */
const ALLOWED_REMOTE_URLS = [
	"https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf",
];

const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)([:/]|$)/i;

describe("local-retrieval privacy invariant (F12.104)", () => {
	it("no retrieval/embedding module contains a non-local, non-allowlisted URL", async () => {
		const files = (await readdir(MODULE_DIR)).filter(
			(name) => PRIVACY_SCOPED_PATTERN.test(name) && name.endsWith(".ts") && !name.endsWith(".test.ts"),
		);
		expect(files.length).toBeGreaterThan(3); // the scope must actually cover the module set
		const violations: string[] = [];
		for (const file of files) {
			const source = await readFile(join(MODULE_DIR, file), "utf8");
			for (const match of source.matchAll(/https?:\/\/[^\s"'`)\]}]+/g)) {
				const url = match[0];
				if (LOCAL_URL.test(url)) {
					continue;
				}
				if (ALLOWED_REMOTE_URLS.some((allowed) => url.startsWith(allowed))) {
					continue;
				}
				violations.push(`${file}: ${url}`);
			}
		}
		expect(
			violations,
			`retrieval/embedding modules gained a remote URL — the local-retrieval privacy guarantee ("embeddings never leave the machine") requires this to be a deliberate reviewed change:\n${violations.join("\n")}`,
		).toEqual([]);
	});
});
