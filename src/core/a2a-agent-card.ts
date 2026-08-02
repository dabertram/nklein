/**
 * A2A Agent Card builder — P17.8, PURE. Builds the discovery document served at
 * `/.well-known/agent-card.json` from injected runtime facts (bound URL, product version).
 *
 * Deliberate pilot posture, stated rather than implied:
 *  - ONE interface: JSONRPC @ protocolVersion "1.0" (spec.md:2153's own canonical example). gRPC/REST
 *    bindings are non-goals until a consumer exists.
 *  - `capabilities` all FALSE: no streaming, no push notifications, no extended card. A capability the card
 *    advertises is a promise a client will exercise; advertising nothing false is the §4A rule applied to a
 *    discovery document (a card that overclaims is a wire-level confident overclaim).
 *  - NO securitySchemes: the pilot binds loopback-only and the runtime's own bearer token gates the RPC
 *    endpoint; publishing an OAuth scheme we do not operate would be another overclaim. Cross-host serving
 *    (fleet return) is the moment security schemes become real, not before.
 *  - Signatures omitted: signing is for cards that travel; a loopback card does not.
 */

import type { A2aAgentCard } from "./a2a-wire-shapes";
import { A2A_PROTOCOL_BINDING_JSONRPC, A2A_PROTOCOL_VERSION } from "./a2a-wire-shapes";

export interface BuildA2aAgentCardInput {
	/** The externally reachable RPC URL for THIS server (loopback in the pilot), e.g. http://127.0.0.1:3484/a2a/v1. */
	rpcUrl: string;
	/** Product version string (injected — pure code reads no package.json). */
	productVersion: string;
}

export function buildA2aAgentCard(input: BuildA2aAgentCardInput): A2aAgentCard {
	return {
		name: "!Klein",
		description:
			"Local-first autonomous kanban engineering agent. A delegated task becomes a board card: it is " +
			"planned, implemented in an isolated sandbox, acceptance-checked, and second-opinion reviewed by " +
			"local models before completion. Text-only intake; artifacts are returned on completion.",
		supportedInterfaces: [
			{
				url: input.rpcUrl,
				protocolBinding: A2A_PROTOCOL_BINDING_JSONRPC,
				protocolVersion: A2A_PROTOCOL_VERSION,
			},
		],
		version: input.productVersion,
		capabilities: {
			streaming: false,
			pushNotifications: false,
			extendedAgentCard: false,
		},
		defaultInputModes: ["text/plain"],
		defaultOutputModes: ["text/plain"],
		skills: [
			{
				id: "kanban-task-execution",
				name: "Kanban task execution",
				description:
					"Delegate an engineering task as text; it is executed as a supervised board card with " +
					"sandboxed implementation, acceptance evidence, and independent local-model review.",
				tags: ["coding", "kanban", "local-only", "sandboxed"],
			},
		],
	};
}
