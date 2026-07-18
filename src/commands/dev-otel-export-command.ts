import { attemptEventToOtelSpans, buildOtlpTracePayload, type OtelSpanJson } from "../core/otel-genai-export";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";

/**
 * F12.47 effectful half — `nklein dev otel-export`: read the agent-attempt ledger, map attempt events to OTel
 * GenAI spans (pure core), and either PRINT the OTLP payload (default — inspect/pipe) or POST it to a local
 * OTLP/HTTP collector (`--endpoint http://localhost:4318` or NKLEIN_OTEL_ENDPOINT) so a self-hosted
 * Langfuse/Phoenix renders the traces. Deterministic span ids make re-export idempotent on the receiver, so
 * running this repeatedly (cron, post-run hook) is safe. Local-only by design: the endpoint must be loopback
 * unless --allow-remote is passed (the prime directive's egress posture applies to telemetry too).
 */
export async function runDevOtelExportCommand(options: {
	endpoint?: string;
	task?: string;
	since?: string;
	limit?: number;
	serviceName?: string;
	allowRemote?: boolean;
	json?: boolean;
}): Promise<void> {
	const events = await readAllAgentLedger();
	const sinceMs = options.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
	const attempts = events
		.filter((event): event is Extract<typeof event, { kind: "attempt" }> => event.kind === "attempt")
		.filter((event) => (options.task ? event.taskId === options.task : true))
		.filter((event) => event.recordedAt >= sinceMs);
	const bounded = options.limit && options.limit > 0 ? attempts.slice(-options.limit) : attempts;
	const spans: OtelSpanJson[] = bounded.flatMap((event) => attemptEventToOtelSpans(event));
	const payload = buildOtlpTracePayload(spans, { serviceName: options.serviceName ?? "nklein" });

	const endpoint = options.endpoint ?? process.env.NKLEIN_OTEL_ENDPOINT ?? "";
	if (!endpoint) {
		if (options.json) {
			process.stdout.write(`${JSON.stringify(payload)}\n`);
		} else {
			process.stdout.write(
				`Mapped ${bounded.length} attempt event(s) → ${spans.length} span(s). No endpoint given — printing payload (use --endpoint or NKLEIN_OTEL_ENDPOINT to POST).\n`,
			);
			process.stdout.write(`${JSON.stringify(payload, null, 1).slice(0, 4000)}\n`);
		}
		return;
	}

	let host = "";
	try {
		host = new URL(endpoint).hostname;
	} catch {
		process.stderr.write(`Invalid --endpoint URL: ${endpoint}\n`);
		process.exitCode = 1;
		return;
	}
	const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
	if (!loopback && !options.allowRemote) {
		process.stderr.write(
			`Refusing non-loopback OTel endpoint ${endpoint} (local-only posture). Pass --allow-remote to override deliberately.\n`,
		);
		process.exitCode = 1;
		return;
	}

	const url = `${endpoint.replace(/\/+$/u, "")}/v1/traces`;
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (response.ok) {
			process.stdout.write(
				`Exported ${spans.length} span(s) from ${bounded.length} attempt(s) → ${url} (${response.status}).\n`,
			);
		} else {
			process.stderr.write(`OTLP endpoint answered ${response.status}: ${(await response.text()).slice(0, 300)}\n`);
			process.exitCode = 1;
		}
	} catch (error) {
		process.stderr.write(`POST ${url} failed: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
