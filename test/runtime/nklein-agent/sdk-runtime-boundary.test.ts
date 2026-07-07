import { describe, expect, it } from "vitest";
import {
	listNKleinSdkWorkflowSlashCommands,
	type NKleinSdkUserInstructionService,
} from "../../../src/nklein-agent/sdk-runtime-boundary";

/**
 * The one piece of real logic at the SDK boundary: merging the built-in slash commands with a user-instruction
 * service's runtime commands. Built-ins must win on a name collision (so a user workflow can't shadow a core command),
 * and a runtime command's kind must map to the right description. The rest of the module is thin SDK delegation.
 */
function fakeService(
	commands: ReadonlyArray<{ name: string; instructions: string; kind: "workflow" | "skill" }>,
): NKleinSdkUserInstructionService {
	// Only `listRuntimeCommands` is exercised here; cast a minimal stand-in to the full service interface.
	return { listRuntimeCommands: () => commands } as unknown as NKleinSdkUserInstructionService;
}

describe("listNKleinSdkWorkflowSlashCommands", () => {
	it("returns just the built-ins (with empty instructions) when no service is supplied", () => {
		const commands = listNKleinSdkWorkflowSlashCommands();
		expect(commands.length).toBeGreaterThan(0);
		// Every built-in is present, carries its description, and has empty instructions (built-ins aren't runtime text).
		const clear = commands.find((command) => command.name === "clear");
		expect(clear).toBeDefined();
		expect(clear?.instructions).toBe("");
		expect(clear?.description).toContain("fresh chat");
	});

	it("appends runtime commands and maps their kind to a description", () => {
		const commands = listNKleinSdkWorkflowSlashCommands(
			fakeService([
				{ name: "deploy", instructions: "do a deploy", kind: "workflow" },
				{ name: "lint", instructions: "run the linter", kind: "skill" },
			]),
		);
		const deploy = commands.find((command) => command.name === "deploy");
		const lint = commands.find((command) => command.name === "lint");
		expect(deploy).toEqual({ name: "deploy", instructions: "do a deploy", description: "Workflow command" });
		expect(lint).toEqual({ name: "lint", instructions: "run the linter", description: "Skill command" });
	});

	it("lets a built-in WIN a name collision — a runtime command can't shadow a core command", () => {
		const commands = listNKleinSdkWorkflowSlashCommands(
			fakeService([{ name: "clear", instructions: "hijacked", kind: "workflow" }]),
		);
		const clears = commands.filter((command) => command.name === "clear");
		expect(clears).toHaveLength(1); // deduped by name
		expect(clears[0]?.instructions).toBe(""); // the BUILT-IN, not the runtime "hijacked" text
		expect(clears[0]?.description).toContain("fresh chat");
	});

	it("dedups repeated runtime command names (first occurrence wins)", () => {
		const commands = listNKleinSdkWorkflowSlashCommands(
			fakeService([
				{ name: "deploy", instructions: "first", kind: "workflow" },
				{ name: "deploy", instructions: "second", kind: "skill" },
			]),
		);
		const deploys = commands.filter((command) => command.name === "deploy");
		expect(deploys).toHaveLength(1);
		expect(deploys[0]?.instructions).toBe("first");
	});
});
