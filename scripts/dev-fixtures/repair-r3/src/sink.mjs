import { immediateIo } from "./io.mjs";

/**
 * The downstream record sink.
 *
 * `write` is asynchronous: it takes two IO turns to flush before the record is durable. `inFlight` counts the
 * writes that have been started and not yet landed, which is how a caller can tell whether it has finished with the
 * sink or merely started it.
 */
export function createSink(io = immediateIo) {
	const sink = {
		records: [],
		inFlight: 0,
		async write(record) {
			sink.inFlight += 1;
			await io.yield();
			await io.yield();
			sink.records.push(record);
			sink.inFlight -= 1;
		},
	};
	return sink;
}
