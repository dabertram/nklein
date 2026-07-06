import { describe, expect, it } from "vitest";
import { AGENT_SANDBOX_VOLUME_PREFIX } from "../../../src/nklein-agent/nklein-agent-sandbox-docker";
import {
	escapeRegExp,
	isAgentSandboxExecResult,
	isAgentSandboxWorkspaceVolumeName,
	isContainerMissingError,
} from "../../../src/nklein-agent/nklein-agent-sandbox-predicates";

describe("isContainerMissingError (§5.U extraction)", () => {
	it("matches docker's no-such-container / no-such-object messages case-insensitively", () => {
		expect(isContainerMissingError("Error: No such container: abc")).toBe(true);
		expect(isContainerMissingError("no such object")).toBe(true);
		expect(isContainerMissingError("NO SUCH OBJECT: x")).toBe(true);
	});

	it("does not match unrelated errors", () => {
		expect(isContainerMissingError("permission denied")).toBe(false);
		expect(isContainerMissingError("")).toBe(false);
	});
});

describe("escapeRegExp (§5.U extraction)", () => {
	it("escapes regex metacharacters so the string matches literally", () => {
		expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
		const escaped = escapeRegExp("v1.2+x");
		expect(new RegExp(`^${escaped}$`).test("v1.2+x")).toBe(true);
		expect(new RegExp(`^${escaped}$`).test("v1X2Yx")).toBe(false);
	});

	it("leaves a plain string unchanged", () => {
		expect(escapeRegExp("plain-name_1")).toBe("plain-name_1");
	});
});

describe("isAgentSandboxWorkspaceVolumeName (§5.U extraction)", () => {
	it("matches <prefix>-<digits> and rejects anything else", () => {
		expect(isAgentSandboxWorkspaceVolumeName(`${AGENT_SANDBOX_VOLUME_PREFIX}-0`)).toBe(true);
		expect(isAgentSandboxWorkspaceVolumeName(`${AGENT_SANDBOX_VOLUME_PREFIX}-42`)).toBe(true);
		expect(isAgentSandboxWorkspaceVolumeName(`${AGENT_SANDBOX_VOLUME_PREFIX}-`)).toBe(false);
		expect(isAgentSandboxWorkspaceVolumeName(`${AGENT_SANDBOX_VOLUME_PREFIX}-1a`)).toBe(false);
		expect(isAgentSandboxWorkspaceVolumeName(`other-prefix-1`)).toBe(false);
		expect(isAgentSandboxWorkspaceVolumeName(`x${AGENT_SANDBOX_VOLUME_PREFIX}-1`)).toBe(false);
	});
});

describe("isAgentSandboxExecResult (§5.U extraction)", () => {
	it("accepts an object carrying exitCode/stdout/stderr", () => {
		expect(isAgentSandboxExecResult({ exitCode: 0, stdout: "", stderr: "" })).toBe(true);
		expect(isAgentSandboxExecResult({ exitCode: null, stdout: "x", stderr: "y" })).toBe(true);
	});

	it("rejects non-result values", () => {
		expect(isAgentSandboxExecResult(null)).toBe(false);
		expect(isAgentSandboxExecResult(undefined)).toBe(false);
		expect(isAgentSandboxExecResult("nope")).toBe(false);
		expect(isAgentSandboxExecResult({ exitCode: 0, stdout: "" })).toBe(false);
	});
});
