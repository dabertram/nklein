import { describe, expect, it } from "vitest";
import type { RuntimeBoardData } from "../../../src/core/api-contract";
import {
	isSafeTriggerName,
	parseTriggerPayload,
	renderTriggerCard,
	TRIGGER_PAYLOAD_MAX_BYTES,
	triggerCardTemplateSchema,
} from "../../../src/core/trigger-intake";
import {
	applyTriggerCardToBoard,
	handleTriggerIntake,
	resetTriggerCooldowns,
	type TriggerIntakeDeps,
} from "../../../src/server/trigger-intake-handler";

function board(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{
				id: "ready",
				title: "Ready",
				cards: [
					{
						id: "existing",
						title: "Existing",
						prompt: "existing",
						startInPlanMode: false,
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

const INCIDENT_TEMPLATE = JSON.stringify({
	title: "INCIDENT: {payload.service} down",
	prompt: "Production incident for {payload.service}: gather evidence from the logs, diagnose, propose a fix card.",
});

function makeDeps(overrides?: Partial<TriggerIntakeDeps> & { template?: string | null }) {
	const seeded: Array<{ workspaceId: string; taskId: string; lane: string }> = [];
	const audits: string[] = [];
	const deps: TriggerIntakeDeps = {
		listWorkspaces: async () => [{ workspaceId: "ws-1", repoPath: "/repo-1" }],
		readTemplateFile: async () =>
			overrides && "template" in overrides ? (overrides.template ?? null) : INCIDENT_TEMPLATE,
		seedCard: async ({ entry, template, card }) => {
			seeded.push({ workspaceId: entry.workspaceId, taskId: card.taskId, lane: template.lane });
		},
		audit: async ({ taskId }) => {
			audits.push(taskId);
		},
		now: () => 1_784_400_000_000,
		randomUuid: () => "aaaabbbb-cccc-dddd-eeee-ffff00001111",
		...overrides,
	};
	return { deps, seeded, audits };
}

describe("trigger-intake core", () => {
	it("accepts safe names and refuses traversal-shaped ones", () => {
		expect(isSafeTriggerName("prod-down")).toBe(true);
		expect(isSafeTriggerName("incident_2")).toBe(true);
		expect(isSafeTriggerName("../etc")).toBe(false);
		expect(isSafeTriggerName("UPPER")).toBe(false);
		expect(isSafeTriggerName("")).toBe(false);
	});

	it("bounds and shapes payloads", () => {
		expect(parseTriggerPayload("")).toEqual({ ok: true, payload: null });
		expect(parseTriggerPayload('{"service":"api"}')).toEqual({ ok: true, payload: { service: "api" } });
		expect(parseTriggerPayload("[1,2]").ok).toBe(false);
		expect(parseTriggerPayload("not json").ok).toBe(false);
		const oversized = JSON.stringify({ blob: "x".repeat(TRIGGER_PAYLOAD_MAX_BYTES) });
		expect(parseTriggerPayload(oversized).ok).toBe(false);
	});

	it("renders substitution tokens, keeps unknown tokens visible, and stamps provenance", () => {
		const template = triggerCardTemplateSchema.parse(JSON.parse(INCIDENT_TEMPLATE));
		const card = renderTriggerCard({
			triggerName: "prod-down",
			template,
			payload: { service: "checkout", typoed: { nested: true } },
			now: 1_784_400_000_000,
			uniqueSuffix: "abc12345",
		});
		expect(card.title).toBe("INCIDENT: checkout down");
		expect(card.prompt).toContain("Production incident for checkout");
		expect(card.prompt).toContain('Seeded by external trigger "prod-down"');
		expect(card.taskId).toBe("trigger-prod-down-1784400000000-abc12345");
		// An unknown token survives verbatim so the template typo is visible on the card.
		const typo = renderTriggerCard({
			triggerName: "t",
			template: { ...template, prompt: "See {payload.missing}" },
			payload: {},
			now: 1,
			uniqueSuffix: "s",
		});
		expect(typo.prompt).toContain("{payload.missing}");
	});

	it("refuses templates declaring autoStart:false instead of silently starting them", () => {
		expect(() => triggerCardTemplateSchema.parse({ title: "t", prompt: "p", autoStart: false })).toThrow();
	});
});

describe("applyTriggerCardToBoard", () => {
	it("seeds the card at the FRONT of the ready lane for incident-style templates", () => {
		const template = triggerCardTemplateSchema.parse(JSON.parse(INCIDENT_TEMPLATE));
		const applied = applyTriggerCardToBoard({
			board: board(),
			template,
			card: { taskId: "trigger-x-1-a", title: "T", prompt: "P" },
			randomUuid: () => "unused",
			now: 5,
		});
		const ready = applied.board.columns.find((column) => column.id === "ready");
		expect(ready?.cards.map((card) => card.id)).toEqual(["trigger-x-1-a", "existing"]);
	});
});

describe("handleTriggerIntake", () => {
	it("seeds + audits a valid fire and reports the card", async () => {
		resetTriggerCooldowns();
		const { deps, seeded, audits } = makeDeps();
		const result = await handleTriggerIntake(
			{ name: "prod-down", bodyText: '{"service":"api"}', workspaceIdParam: null },
			deps,
		);
		expect(result.status).toBe(201);
		expect(result.body.workspaceId).toBe("ws-1");
		expect(seeded).toHaveLength(1);
		expect(audits).toHaveLength(1);
	});

	it("damps an alarm storm (second fire inside the cooldown gets 429)", async () => {
		resetTriggerCooldowns();
		const { deps } = makeDeps();
		expect(
			(await handleTriggerIntake({ name: "prod-down", bodyText: "", workspaceIdParam: null }, deps)).status,
		).toBe(201);
		const damped = await handleTriggerIntake({ name: "prod-down", bodyText: "", workspaceIdParam: null }, deps);
		expect(damped.status).toBe(429);
		resetTriggerCooldowns();
	});

	it("404s an undefined trigger, 409s an ambiguous one, 400s an unsafe name", async () => {
		resetTriggerCooldowns();
		const missing = makeDeps({ template: null });
		expect(
			(await handleTriggerIntake({ name: "nope", bodyText: "", workspaceIdParam: null }, missing.deps)).status,
		).toBe(404);
		const ambiguous = makeDeps({
			listWorkspaces: async () => [
				{ workspaceId: "ws-1", repoPath: "/repo-1" },
				{ workspaceId: "ws-2", repoPath: "/repo-2" },
			],
		});
		const conflict = await handleTriggerIntake(
			{ name: "prod-down", bodyText: "", workspaceIdParam: null },
			ambiguous.deps,
		);
		expect(conflict.status).toBe(409);
		expect(conflict.body.workspaceIds).toEqual(["ws-1", "ws-2"]);
		// …and the ?workspaceId= disambiguation resolves it.
		const chosen = await handleTriggerIntake(
			{ name: "prod-down", bodyText: "", workspaceIdParam: "ws-2" },
			ambiguous.deps,
		);
		expect(chosen.status).toBe(201);
		expect(chosen.body.workspaceId).toBe("ws-2");
		expect(
			(await handleTriggerIntake({ name: "../evil", bodyText: "", workspaceIdParam: null }, makeDeps().deps)).status,
		).toBe(400);
		resetTriggerCooldowns();
	});

	it("releases the cooldown when seeding fails so a corrected retry is not damped", async () => {
		resetTriggerCooldowns();
		let fail = true;
		const { deps } = makeDeps({
			seedCard: async () => {
				if (fail) {
					throw new Error("board locked");
				}
			},
		});
		const failed = await handleTriggerIntake({ name: "prod-down", bodyText: "", workspaceIdParam: null }, deps);
		expect(failed.status).toBe(500);
		fail = false;
		const retried = await handleTriggerIntake({ name: "prod-down", bodyText: "", workspaceIdParam: null }, deps);
		expect(retried.status).toBe(201);
		resetTriggerCooldowns();
	});

	it("422s an invalid template with the file path in the message", async () => {
		resetTriggerCooldowns();
		const { deps } = makeDeps({ template: '{"title":""}' });
		const result = await handleTriggerIntake({ name: "prod-down", bodyText: "", workspaceIdParam: null }, deps);
		expect(result.status).toBe(422);
		expect(String(result.body.error)).toContain(".nklein/triggers/prod-down.json");
	});
});
