import { describe, expect, it } from "vitest";
import { resolveToolNameAlias } from "./tool-name-alias";

const AVAILABLE = [
	"read_files",
	"write_file",
	"write_files",
	"edit_file",
	"list_files",
	"run_commands",
	"search_codebase",
	"apply_patch",
	"fetch_web_content",
];

describe("resolveToolNameAlias (§5.BD tool-name aliasing)", () => {
	it("resolves the evidenced singular→plural miss (read_file → read_files)", () => {
		expect(resolveToolNameAlias("read_file", AVAILABLE)).toBe("read_files");
		expect(resolveToolNameAlias("run_command", AVAILABLE)).toBe("run_commands");
	});

	it("resolves case / camelCase / spacing variants of a real tool", () => {
		expect(resolveToolNameAlias("readFiles", AVAILABLE)).toBe("read_files");
		expect(resolveToolNameAlias("Read_Files", AVAILABLE)).toBe("read_files");
		expect(resolveToolNameAlias("read files", AVAILABLE)).toBe("read_files");
		expect(resolveToolNameAlias("SEARCH_CODEBASE", AVAILABLE)).toBe("search_codebase");
	});

	it("resolves curated synonyms, gated on the canonical tool being available", () => {
		expect(resolveToolNameAlias("grep", AVAILABLE)).toBe("search_codebase");
		expect(resolveToolNameAlias("bash", AVAILABLE)).toBe("run_commands");
		expect(resolveToolNameAlias("ls", AVAILABLE)).toBe("list_files");
		expect(resolveToolNameAlias("browse_url", AVAILABLE)).toBe("fetch_web_content");
		expect(resolveToolNameAlias("cat", AVAILABLE)).toBe("read_files");
		// gated: if the target tool isn't offered, no alias
		expect(resolveToolNameAlias("grep", ["read_files"])).toBeNull();
		expect(resolveToolNameAlias("ls", ["read_files"])).toBeNull();
	});

	it("recovers a Mistral/Devstral marker suffix leaked into the parsed tool name", () => {
		const polluted =
			'[{"query":"src/index.ts","result":"...","success":true}][TOOL_CALLS]read_files';
		expect(resolveToolNameAlias(polluted, AVAILABLE)).toBe("read_files");
		expect(resolveToolNameAlias("previous output [TOOL_CALL]SEARCH_CODEBASE", AVAILABLE)).toBe("search_codebase");
		expect(resolveToolNameAlias("[TOOL_CALLS]delete_everything", AVAILABLE)).toBeNull();
	});

	it("returns null for an already-available name, an unknown name, and empty inputs", () => {
		expect(resolveToolNameAlias("read_files", AVAILABLE)).toBeNull();
		expect(resolveToolNameAlias("edit_file", AVAILABLE)).toBeNull();
		expect(resolveToolNameAlias("frobnicate", AVAILABLE)).toBeNull();
		expect(resolveToolNameAlias("", AVAILABLE)).toBeNull();
		expect(resolveToolNameAlias("read_file", [])).toBeNull();
	});

	it("never returns a name outside the available set", () => {
		// write_file and write_files both exist; a miss like write_to_file maps to write_file (present)…
		expect(resolveToolNameAlias("write_to_file", AVAILABLE)).toBe("write_file");
		// …but if only write_files is offered, write_to_file's synonym target (write_file) is absent → plural rule
		// finds write_files instead (writetofile has no plural; synonym gated out) ⇒ null, never an invented name.
		const onlyPlural = ["write_files", "read_files"];
		const result = resolveToolNameAlias("write_to_file", onlyPlural);
		expect(result === null || onlyPlural.includes(result)).toBe(true);
	});
});
