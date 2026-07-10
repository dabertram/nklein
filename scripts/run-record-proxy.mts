/**
 * §13d PASSTHROUGH CAPTURE — run the LLM-simulator record proxy in front of a REAL local endpoint (LM Studio /
 * Ollama). Point !Klein's provider baseUrl at the printed URL and work normally: every request/response is
 * persisted as an aimock fixture for the distill step (scripts/distill-capture.mts) to fold into scenario tracks.
 *
 * Usage:  npx tsx scripts/run-record-proxy.mts [--upstream http://127.0.0.1:1234] [--out captures/<name>] [--port 0]
 *         (Ctrl-C to stop; the fixture dir accumulates one JSON per interaction.)
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRecordProxy } from "../packages/llm-simulator/src/index.js";

function argValue(flag: string, fallback: string): string {
	const index = process.argv.indexOf(flag);
	return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}

const upstream = argValue("--upstream", "http://127.0.0.1:1234");
const out = resolve(argValue("--out", `captures/${new Date().toISOString().slice(0, 10)}`));
const port = Number(argValue("--port", "0"));

mkdirSync(out, { recursive: true });
const proxy = createRecordProxy({ upstreamOpenAiUrl: upstream, fixturePath: out, port });
await proxy.start();
console.log(`Record proxy up.
  upstream : ${upstream}
  captures : ${out}
  point !Klein's provider baseUrl at:  ${proxy.url()}
Ctrl-C to stop.`);

process.on("SIGINT", () => {
	void proxy.stop().finally(() => process.exit(0));
});
