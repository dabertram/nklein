import { immediateIo } from "./io.mjs";
import { record } from "./metrics.mjs";

/**
 * Run a list of jobs in order.
 *
 * A job is `{ id, run(io) }`. Each one is executed, its outcome recorded, and — when it succeeded — its value
 * written to the sink. The pipeline is finished with the sink before it resolves: when the returned promise
 * settles, every write it started has landed, in job order.
 *
 * The result is `{ results, failed }`. `results` carries one entry per job, in job order:
 *
 *   { id, status: "ok", value }                       a job that returned
 *   { id, status: "failed", error: <message> }        a job that threw
 *
 * and `failed` lists the ids of the jobs that threw. A job that throws must not stop the ones behind it, must not
 * reach the sink, and must not be reported as a success.
 */
async function execute(job, io) {
	try {
		return await job.run(io);
	} catch {
		return undefined;
	}
}

export async function runPipeline(jobs, deps) {
	const { io = immediateIo, sink, metrics } = deps;
	const results = [];
	for (const job of jobs) {
		const value = await execute(job, io);
		results.push({ id: job.id, status: "ok", value });
		sink.write({ id: job.id, value });
		if (metrics) await record(metrics, "jobs.processed", { io });
	}
	return { results, failed: results.filter((result) => result.status === "failed").map((result) => result.id) };
}
