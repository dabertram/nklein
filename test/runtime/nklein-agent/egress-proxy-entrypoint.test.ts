import { describe, expect, it } from "vitest";
import type { EgressProxyDnsSocket } from "../../../src/nklein-agent/egress-proxy-dns-stub";
import {
	buildEgressProxyListeners,
	createEgressProxyRuntime,
	EGRESS_PROXY_ROLE_PORTS,
} from "../../../src/nklein-agent/egress-proxy-entrypoint";
import type { EgressProxyNetServer } from "../../../src/nklein-agent/egress-proxy-server";

/** A fake net-server factory that records every `listen(port)` so the test can assert the bound listener ports. */
function createRecordingNetServerFactory(): { boundPorts: number[]; factory: () => EgressProxyNetServer } {
	const boundPorts: number[] = [];
	return {
		boundPorts,
		factory: () => ({
			listen(port, _host, onListening) {
				boundPorts.push(port);
				onListening();
			},
			close(onClosed) {
				onClosed();
			},
		}),
	};
}

/** A fake dgram socket that binds without touching the network. */
function createFakeDnsSocket(): EgressProxyDnsSocket {
	return {
		on() {},
		bind(_port, _address, onBound) {
			onBound();
		},
		send() {},
		close(onClosed) {
			onClosed?.();
		},
	};
}

describe("createEgressProxyRuntime — §4 wiring", () => {
	it("exposes exactly the three role listeners on the §4 role ports (3128/3129/3130)", () => {
		const runtime = createEgressProxyRuntime();
		expect(runtime.listeners).toEqual([
			{ role: "architect", listenerPort: 3128 },
			{ role: "worker", listenerPort: 3129 },
			{ role: "reviewer", listenerPort: 3130 },
		]);
		expect(EGRESS_PROXY_ROLE_PORTS).toEqual({ architect: 3128, worker: 3129, reviewer: 3130 });
	});

	it("start() binds one listener per role port and starts the DNS stub", async () => {
		const net = createRecordingNetServerFactory();
		let dnsBound = false;
		const runtime = createEgressProxyRuntime({
			netServerFactory: net.factory,
			dnsSocketFactory: () => {
				const socket = createFakeDnsSocket();
				return {
					...socket,
					bind(port, address, onBound) {
						dnsBound = true;
						socket.bind(port, address, onBound);
					},
				};
			},
			resolveHost: async () => ["93.184.216.34"],
			dial: async () => {
				throw new Error("dial should not be called in a wiring test");
			},
			auditSink: () => {},
		});
		await runtime.start();
		expect(net.boundPorts.sort((a, b) => a - b)).toEqual([3128, 3129, 3130]);
		expect(dnsBound).toBe(true);
		await runtime.stop();
	});

	it("forwards DNS query names to the best-effort onDnsQuery observability seam", async () => {
		let messageListener: ((msg: Buffer, rinfo: { address: string; port: number }) => void) | undefined;
		const seen: string[] = [];
		const runtime = createEgressProxyRuntime({
			netServerFactory: createRecordingNetServerFactory().factory,
			onDnsQuery: (name) => seen.push(name),
			dnsSocketFactory: () => ({
				on(event, listener) {
					if (event === "message") {
						messageListener = listener as typeof messageListener;
					}
				},
				bind(_port, _address, onBound) {
					onBound();
				},
				send() {},
				close(onClosed) {
					onClosed?.();
				},
			}),
		});
		await runtime.start();
		// Minimal query for "probe.test" so the stub extracts + forwards the name.
		const header = Buffer.alloc(12);
		header.writeUInt16BE(1, 4);
		const qname = Buffer.concat([
			Buffer.from([5]),
			Buffer.from("probe"),
			Buffer.from([4]),
			Buffer.from("test"),
			Buffer.from([0, 0, 1, 0, 1]),
		]);
		messageListener?.(Buffer.concat([header, qname]), { address: "10.0.0.2", port: 5353 });
		expect(seen).toEqual(["probe.test"]);
		await runtime.stop();
	});
});

describe("buildEgressProxyListeners", () => {
	it("returns the fixed role→port triple in AGENT_RULESET_ROLES order", () => {
		expect(buildEgressProxyListeners()).toEqual([
			{ role: "architect", listenerPort: 3128 },
			{ role: "worker", listenerPort: 3129 },
			{ role: "reviewer", listenerPort: 3130 },
		]);
	});
});
