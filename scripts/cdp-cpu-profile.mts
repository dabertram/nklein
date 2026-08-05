/**
 * Attach-and-sample CPU profiler for a RUNNING node process — the soak forensics tool that does not depend
 * on exit-flush (a SIGTERM'd --cpu-prof process loses its profile; live-hit twice, 2026-08-05).
 *
 * Usage: tsx scripts/cdp-cpu-profile.mts <pid> <seconds> <out.cpuprofile>
 * Sends SIGUSR1 (opens the inspector on 127.0.0.1:9229), connects over CDP with node's built-in WebSocket,
 * runs Profiler.start/stop for the window, writes the .cpuprofile. Local-only by construction.
 */

import { writeFile } from "node:fs/promises";

const [pidArg, secondsArg, outPath] = process.argv.slice(2);
const pid = Number(pidArg);
const seconds = Math.max(5, Number(secondsArg ?? "60"));
if (!Number.isInteger(pid) || pid <= 0 || !outPath) {
	process.stderr.write("usage: cdp-cpu-profile.mts <pid> <seconds> <out.cpuprofile>\n");
	process.exit(64);
}

process.kill(pid, "SIGUSR1");
await new Promise((settle) => setTimeout(settle, 1_500));

const listResponse = await fetch("http://127.0.0.1:9229/json/list");
const targets = (await listResponse.json()) as Array<{ webSocketDebuggerUrl?: string }>;
const wsUrl = targets[0]?.webSocketDebuggerUrl;
if (!wsUrl) {
	process.stderr.write("no inspector target found on 127.0.0.1:9229\n");
	process.exit(1);
}

const socket = new WebSocket(wsUrl);
let nextId = 1;
const pending = new Map<number, (value: unknown) => void>();
socket.addEventListener("message", (event) => {
	const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
	if (message.id && pending.has(message.id)) {
		pending.get(message.id)?.(message.result);
		pending.delete(message.id);
	}
});
await new Promise((settle, reject) => {
	socket.addEventListener("open", () => settle(undefined));
	socket.addEventListener("error", (event) => reject(event));
});
const send = (method: string, params: Record<string, unknown> = {}) =>
	new Promise<unknown>((settle) => {
		const id = nextId++;
		pending.set(id, settle);
		socket.send(JSON.stringify({ id, method, params }));
	});

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 500 });
await send("Profiler.start");
process.stdout.write(`profiling pid ${pid} for ${seconds}s…\n`);
await new Promise((settle) => setTimeout(settle, seconds * 1_000));
const result = (await send("Profiler.stop")) as { profile: unknown };
await writeFile(outPath, JSON.stringify(result.profile));
process.stdout.write(`profile written: ${outPath}\n`);
socket.close();
