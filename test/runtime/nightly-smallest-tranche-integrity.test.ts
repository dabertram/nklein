import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface ScenarioCall {
	readonly name?: string;
	readonly arguments?: unknown;
}

interface ScenarioBehavior {
	readonly kind?: string;
	readonly status?: number;
	readonly content?: string;
	readonly reasoning?: string;
	readonly calls?: readonly ScenarioCall[];
}

interface ScenarioTrack {
	readonly requestClass?: string;
	readonly provenance?: string;
	readonly turns?: readonly { readonly behavior?: ScenarioBehavior }[];
}

interface ScenarioScript {
	readonly tracks?: readonly ScenarioTrack[];
}

interface ManifestProject {
	readonly id: string;
	readonly fixture: string;
	readonly recordingSet: string;
	readonly modelProfiles: readonly string[];
}

const SCENARIOS_DIR = "packages/llm-simulator/scenarios";

function readScenario(fixture: string, run: "perfect" | "flaky"): ScenarioScript {
	return JSON.parse(readFileSync(join(SCENARIOS_DIR, fixture, `${run}-run.json`), "utf8")) as ScenarioScript;
}

function scriptedCost(fixture: string): { fixture: string; turns: number; bytes: number } {
	let turns = 0;
	let bytes = 0;
	for (const run of ["perfect", "flaky"] as const) {
		const path = join(SCENARIOS_DIR, fixture, `${run}-run.json`);
		const scenario = readScenario(fixture, run);
		turns += (scenario.tracks ?? []).reduce((sum, track) => sum + (track.turns?.length ?? 0), 0);
		bytes += statSync(path).size;
	}
	return { fixture, turns, bytes };
}

function allCalls(script: ScenarioScript): ScenarioCall[] {
	return (script.tracks ?? []).flatMap((track) =>
		(track.turns ?? []).flatMap((turn) =>
			turn.behavior?.kind === "tool_calls" ? [...(turn.behavior.calls ?? [])] : [],
		),
	);
}

describe("N2 smallest-ten nightly tranche", () => {
	const manifest = JSON.parse(readFileSync("nightly-manifest.json", "utf8")) as {
		projects?: readonly ManifestProject[];
	};
	const projects = manifest.projects ?? [];
	const lowerTwenty = readdirSync(SCENARIOS_DIR)
		.filter((name) => /^(?:0[1-9]|1\d|20)_/.test(name))
		.map(scriptedCost)
		.sort((a, b) => a.turns - b.turns || a.bytes - b.bytes || a.fixture.localeCompare(b.fixture));

	it("registers exactly the ten cheapest complete perfect+flaky recordings", () => {
		// Cost is the total scripted model turns in both profiles; bytes break ties. This directly measures the
		// sequential nightly work rather than guessing from prose/spec size, and recomputes whenever a set changes.
		expect(lowerTwenty).toHaveLength(20);
		expect(projects).toHaveLength(10);
		expect(projects.map((project) => project.fixture)).toEqual(
			lowerTwenty.slice(0, 10).map((entry) => entry.fixture),
		);
	});

	it("binds every manifest id and recording-set id to an exact existing fixture", () => {
		for (const project of projects) {
			expect(project.fixture.startsWith(`${project.id}_`), `${project.id} does not own ${project.fixture}`).toBe(
				true,
			);
			expect(project.recordingSet).toBe(`sim-${project.id}`);
			// Both BASELINE profiles are mandatory for every tranche project; N2 mechanism profiles (loop_park, …)
			// may be added per project on top — each still needs its exact `<profile-with-dashes>-run.json` recording.
			expect(project.modelProfiles.slice(0, 2)).toEqual(["perfect", "flaky"]);
			for (const run of project.modelProfiles) {
				expect(existsSync(join(SCENARIOS_DIR, project.fixture, `${run.replaceAll("_", "-")}-run.json`))).toBe(true);
			}
		}
	});

	it("keeps the full happy-path lifecycle and a real request-changes bounce in every perfect recording", () => {
		for (const project of projects) {
			const scenario = readScenario(project.fixture, "perfect");
			const classes = new Set((scenario.tracks ?? []).map((track) => track.requestClass));
			for (const required of ["any", "worker", "review", "chat"]) {
				expect(classes.has(required), `${project.id} lacks ${required} requests`).toBe(true);
			}
			const calls = allCalls(scenario);
			expect(
				calls.some((call) => call.name === "decompose_project"),
				`${project.id} never decomposes`,
			).toBe(true);
			expect(
				calls.some((call) => call.name === "write_files"),
				`${project.id} never writes`,
			).toBe(true);
			expect(
				calls.some((call) => call.name === "run_commands"),
				`${project.id} never runs acceptance`,
			).toBe(true);
			const reviewArgs = calls
				.filter((call) => call.name === "submit_review")
				.map((call) => call.arguments as { verdict?: string } | undefined);
			expect(
				reviewArgs.some((args) => args?.verdict === "request_changes"),
				`${project.id} has no review bounce`,
			).toBe(true);
			expect(
				reviewArgs.some((args) => args?.verdict === "approve"),
				`${project.id} has no approval`,
			).toBe(true);
		}
	});

	it("keeps all five recovery families in every flaky recording", () => {
		for (const project of projects) {
			const scenario = readScenario(project.fixture, "flaky");
			const behaviors = (scenario.tracks ?? []).flatMap((track) =>
				(track.turns ?? []).map((turn) => turn.behavior ?? {}),
			);
			expect(
				behaviors.some((behavior) => behavior.kind === "http_error" && behavior.status === 429),
				`${project.id} lacks 429 recovery`,
			).toBe(true);
			expect(
				behaviors.some((behavior) => behavior.kind === "empty_completion"),
				`${project.id} lacks empty recovery`,
			).toBe(true);
			expect(
				behaviors.some(
					(behavior) => behavior.kind === "text" && behavior.content === "" && Boolean(behavior.reasoning?.trim()),
				),
				`${project.id} lacks reasoning-only recovery`,
			).toBe(true);
			expect(
				behaviors.some((behavior) => behavior.kind === "stall"),
				`${project.id} lacks stalled-stream recovery`,
			).toBe(true);
			expect(
				allCalls(scenario).some(
					(call) =>
						call.name === "write_files" &&
						typeof (call.arguments as { files?: unknown } | undefined)?.files === "string",
				),
				`${project.id} lacks truncated-tool recovery`,
			).toBe(true);
		}
	});
});
