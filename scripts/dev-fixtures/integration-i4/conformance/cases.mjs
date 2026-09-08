/**
 * The conformance suite. FROZEN: evidence, not workspace.
 *
 * A fresh service and a fresh consumer per case. The handler each case supplies records what it was given and,
 * where it matters, WHEN — because the difference between at-least-once and at-most-once is entirely a question of
 * whether the checkpoint moves before or after the work.
 */

const eventCalls = (service) => service.calls().filter((call) => call.path === "/events");
const checkpointWrites = (service) => service.calls().filter((call) => call.method === "PUT" && call.path.startsWith("/checkpoints/"));

/** A handler that remembers every event it saw and how many service calls had happened at that moment. */
function recorder(over = {}) {
	const seen = [];
	return {
		seen,
		handle: async (event, service) => {
			seen.push({ id: event.id, seq: event.seq, callsBefore: service ? service.calls().length : null });
			if (over.throwOn === event.id) {
				throw new Error(`handler refused ${event.id}`);
			}
		},
	};
}

export const cases = [
	{
		id: "C01",
		title: "every event is handled, in sequence order",
		run: async (makeConsumer, service, assert) => {
			const { seen, handle } = recorder();
			await makeConsumer(service, { handle }).run();
			assert.deepEqual(
				seen.map((entry) => entry.seq),
				service.allEvents().map((event) => event.seq),
			);
		},
	},
	{
		id: "C02",
		title: "the boundary event the stream re-delivers is handled exactly once",
		run: async (makeConsumer, service, assert) => {
			const { seen, handle } = recorder();
			await makeConsumer(service, { handle }).run();
			const ids = seen.map((entry) => entry.id);
			assert.equal(new Set(ids).size, ids.length, `an event was handled twice: ${ids.join(",")}`);
			// The service really does send it twice — this is not a stream that happens to be clean.
			const delivered = eventCalls(service).length;
			assert.ok(delivered >= 2, "the stream is read in more than one batch, so a boundary event exists");
		},
	},
	{
		id: "C03",
		title: "the checkpoint is written AFTER the events it covers are handled",
		run: async (makeConsumer, service, assert) => {
			const { seen, handle } = recorder();
			await makeConsumer(service, { handle }).run();
			assert.ok(checkpointWrites(service).length >= 1, "progress must be recorded");
			// `calls()` hands out COPIES, so compare positions, never object identity.
			const firstWriteAt = service
				.calls()
				.findIndex((call) => call.method === "PUT" && call.path.startsWith("/checkpoints/"));
			const firstHandleAt = seen[0].callsBefore;
			assert.ok(
				firstHandleAt <= firstWriteAt,
				"checkpointing before handling turns an at-least-once stream into at-most-once: a crash loses events",
			);
		},
	},
	{
		id: "C04",
		title: "the final checkpoint names the last event handled",
		run: async (makeConsumer, service, assert) => {
			const { handle } = recorder();
			await makeConsumer(service, { handle }).run();
			const events = service.allEvents();
			assert.equal(service.checkpointOf("test-consumer"), String(events[events.length - 1].seq));
		},
	},
	{
		id: "C05",
		title: "a fresh consumer resumes from the stored checkpoint and does not reprocess what is done",
		run: async (makeConsumer, service, assert) => {
			service.setCheckpoint("test-consumer", "4");
			const { seen, handle } = recorder();
			await makeConsumer(service, { handle }).run();
			assert.deepEqual(
				seen.map((entry) => entry.seq),
				[5, 6, 7],
				"the stream re-delivers event 4 at that cursor; a resumed consumer must skip it",
			);
		},
	},
	{
		id: "C06",
		title: "a consumer with no checkpoint starts at the beginning without asking for a cursor",
		run: async (makeConsumer, service, assert) => {
			const { handle } = recorder();
			await makeConsumer(service, { handle }).run();
			const [first] = eventCalls(service);
			assert.equal(first.query.after ?? null, null, "a cold start must not invent a cursor");
		},
	},
	{
		id: "C07",
		title: "a failing handler stops the run and the checkpoint does not pass the failed event",
		run: async (makeConsumer, service, assert) => {
			const { seen, handle } = recorder({ throwOn: "e3" });
			await assert.rejects(() => makeConsumer(service, { handle }).run());
			assert.deepEqual(seen.map((entry) => entry.seq), [1, 2, 3], "it stopped at the failure, not after the batch");
			const checkpoint = service.checkpointOf("test-consumer");
			assert.ok(
				checkpoint === null || Number(checkpoint) < 3,
				`the checkpoint must not cover the failed event, saw ${checkpoint}`,
			);
		},
	},
	{
		id: "C08",
		title: "after a failure a later run reprocesses from the failed event and finishes the stream",
		run: async (makeConsumer, service, assert) => {
			const failing = recorder({ throwOn: "e3" });
			await assert.rejects(() => makeConsumer(service, { handle: failing.handle }).run());
			const second = recorder();
			await makeConsumer(service, { handle: second.handle }).run();
			assert.deepEqual(second.seen.map((entry) => entry.seq), [3, 4, 5, 6, 7], "it must resume at the failure");
			assert.equal(service.checkpointOf("test-consumer"), "7");
		},
	},
	{
		id: "C09",
		title: "the run stops when the stream says there is nothing after",
		run: async (makeConsumer, service, assert) => {
			const { handle } = recorder();
			await makeConsumer(service, { handle }).run();
			assert.ok(eventCalls(service).length <= 3, `7 events at 4 per batch is 2 reads, saw ${eventCalls(service).length}`);
		},
	},
	{
		id: "C10",
		title: "the batch size is honoured and never exceeds what the stream allows",
		run: async (makeConsumer, service, assert) => {
			const { MAX_BATCH } = await import("../service/event-stream-service.mjs");
			const { seen, handle } = recorder();
			await makeConsumer(service, { handle, batchSize: 2 }).run();
			for (const call of eventCalls(service)) {
				const limit = Number(call.query.limit ?? MAX_BATCH);
				assert.equal(limit, 2, "the configured batch size must reach the service");
			}
			assert.deepEqual(seen.map((entry) => entry.seq), [1, 2, 3, 4, 5, 6, 7], "a smaller batch changes nothing else");
		},
	},
];
