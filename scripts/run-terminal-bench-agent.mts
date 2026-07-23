#!/usr/bin/env -S node --import tsx

import { createInterface } from "node:readline";
import { runTerminalBenchSession, type TerminalBenchEnvironmentRpc } from "../src/nklein-agent/nklein-terminal-bench-session";
import type { TerminalBenchExecRequest, TerminalBenchExecResult } from "../src/core/terminal-bench-agent";

interface RpcResponse {
	type: "response";
	id: number;
	result?: TerminalBenchExecResult;
	error?: string;
}

const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
const iterator = lines[Symbol.asyncIterator]();
const first = await iterator.next();
if (first.done) throw new Error("Terminal-Bench bridge closed before configuration.");
const config = JSON.parse(first.value) as unknown;
let nextId = 1;
const pending = new Map<number, { resolve: (value: TerminalBenchExecResult) => void; reject: (error: Error) => void }>();

function rejectPending(error: Error): void {
	for (const request of pending.values()) request.reject(error);
	pending.clear();
}

const responsePump = (async () => {
	try {
		for await (const line of { [Symbol.asyncIterator]: () => iterator }) {
			let response: RpcResponse;
			try {
				response = JSON.parse(line) as RpcResponse;
			} catch {
				throw new Error("Terminal-Bench bridge sent invalid JSON.");
			}
			if (response.type !== "response" || !Number.isInteger(response.id)) {
				throw new Error("Terminal-Bench bridge sent an invalid response envelope.");
			}
			const request = pending.get(response.id);
			if (!request) throw new Error(`Terminal-Bench bridge replied to unknown request ${response.id}.`);
			pending.delete(response.id);
			if (response.error) request.reject(new Error(response.error));
			else if (response.result) request.resolve(response.result);
			else request.reject(new Error("Terminal-Bench bridge response has neither result nor error."));
		}
		if (pending.size > 0) throw new Error("Terminal-Bench bridge closed with tool calls still pending.");
	} catch (error) {
		const failure = error instanceof Error ? error : new Error(String(error));
		rejectPending(failure);
		throw failure;
	}
})();
// Attach a rejection handler immediately: a malformed/closed Harbor stream must reject pending tools, never become an
// unhandled background rejection while the session is still unwinding.
void responsePump.catch(() => undefined);

const rpc: TerminalBenchEnvironmentRpc = {
	exec(request: TerminalBenchExecRequest): Promise<TerminalBenchExecResult> {
		const id = nextId++;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			process.stdout.write(`${JSON.stringify({ type: "exec", id, request })}\n`);
		});
	},
};

try {
	const result = await runTerminalBenchSession(config, rpc);
	process.stdout.write(`${JSON.stringify({ type: "complete", result })}\n`);
} catch (error) {
	process.stdout.write(
		`${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n`,
	);
	process.exitCode = 1;
} finally {
	rejectPending(new Error("Terminal-Bench session ended before Harbor returned the pending tool result."));
	lines.close();
	await responsePump.catch(() => undefined);
}
