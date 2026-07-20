import { createNestedModelTurnAdmissionGate } from "../../../src/core/nested-model-turn-admission";

interface Request {
	taskId: string;
	admissionParentTaskId?: string | null;
}

function createCapOneFixture() {
	let active: string | null = null;
	const waiters: Array<{ request: Request; resolve: (reservation: string) => void }> = [];
	const events: string[] = [];
	const dispatchNext = () => {
		if (active !== null) {
			return;
		}
		const next = waiters.shift();
		if (!next) {
			return;
		}
		active = next.request.taskId;
		events.push(`acquire:${next.request.taskId}`);
		next.resolve(next.request.taskId);
	};
	const gate = createNestedModelTurnAdmissionGate<Request, string>({
		acquire: async (request) => {
			if (active === null) {
				active = request.taskId;
				events.push(`acquire:${request.taskId}`);
				return request.taskId;
			}
			return await new Promise<string>((resolve) => {
				waiters.push({ request, resolve });
			});
		},
		release: (reservation) => {
			expect(active).toBe(reservation);
			events.push(`release:${reservation}`);
			active = null;
			dispatchNext();
		},
		onCapacityFreed: () => {
			events.push("capacity-freed");
			dispatchNext();
		},
	});
	return { gate, events, getActive: () => active };
}

describe("nested model-turn admission", () => {
	it("hands the only reservation to an awaited child and reacquires the parent before it resumes", async () => {
		const fixture = createCapOneFixture();
		await fixture.gate({ taskId: "card" }, async () => {
			expect(fixture.getActive()).toBe("card");
			await fixture.gate({ taskId: "card::plan-critique", admissionParentTaskId: "card" }, async () => {
				expect(fixture.getActive()).toBe("card::plan-critique");
				fixture.events.push("run:child");
			});
			expect(fixture.getActive()).toBe("card");
			fixture.events.push("resume:parent");
		});

		expect(fixture.events).toEqual([
			"acquire:card",
			"release:card",
			"acquire:card::plan-critique",
			"run:child",
			"release:card::plan-critique",
			"acquire:card",
			"resume:parent",
			"release:card",
			"capacity-freed",
		]);
	});

	it("keeps unrelated turns behind the cap instead of treating every derived id as reentrant", async () => {
		const fixture = createCapOneFixture();
		let releaseParent: () => void = () => {};
		const parentRun = fixture.gate({ taskId: "card" }, async () => {
			await new Promise<void>((resolve) => {
				releaseParent = resolve;
			});
		});
		let childRan = false;
		const independentChild = fixture.gate({ taskId: "card::review" }, async () => {
			childRan = true;
		});
		await Promise.resolve();
		expect(childRan).toBe(false);
		releaseParent();
		await Promise.all([parentRun, independentChild]);
		expect(childRan).toBe(true);
	});

	it("serializes parallel awaited children and reacquires the parent only after the last one", async () => {
		const fixture = createCapOneFixture();
		await fixture.gate({ taskId: "card" }, async () => {
			await Promise.all([
				fixture.gate({ taskId: "card::eye-1", admissionParentTaskId: "card" }, async () => {
					fixture.events.push("run:eye-1");
				}),
				fixture.gate({ taskId: "card::eye-2", admissionParentTaskId: "card" }, async () => {
					fixture.events.push("run:eye-2");
				}),
			]);
			expect(fixture.getActive()).toBe("card");
		});

		const lastParentAcquire = fixture.events.lastIndexOf("acquire:card");
		expect(lastParentAcquire).toBeGreaterThan(fixture.events.indexOf("run:eye-2"));
		expect(fixture.events.filter((event) => event === "acquire:card")).toHaveLength(2);
	});
});
