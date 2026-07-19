import { createDefaultLmsRunner, fetchLmsPsModelsCached } from "../core/lms-ps-json";
import { buildAiBom, type DeploymentContext, type ModelLicenseFacts } from "../core/model-license-gate";

/**
 * F12.100 — `nklein dev ai-bom`: render the project's AI Bill of Materials over the LOADED fleet (models +
 * versions + licenses + hashes + per-deployment verdict). License labels are not exposed by the local model
 * gateway today, so every model reports `unknown` until an operator supplies a license map — and `unknown`
 * WARNS rather than passing silently, which is the honest default for a compliance surface.
 */
export async function runDevAiBomCommand(options: {
	commercial?: boolean;
	redistributing?: boolean;
	eu?: boolean;
	mau?: string;
	json?: boolean;
}): Promise<void> {
	const models = await fetchLmsPsModelsCached(createDefaultLmsRunner()).catch(() => []);
	const facts: ModelLicenseFacts[] = models.map((model) => ({
		modelKey: model.modelKey || model.identifier,
		// The gateway publishes no license field; leaving it null is the honest read (⇒ unknown ⇒ warn).
		license: null,
		version: null,
		hash: null,
	}));
	const parsedMau = options.mau === undefined ? Number.NaN : Number.parseInt(options.mau, 10);
	const context: DeploymentContext = {
		commercial: options.commercial === true,
		redistributing: options.redistributing === true,
		...(options.eu === true ? { euDeployment: true } : {}),
		...(Number.isFinite(parsedMau) ? { monthlyActiveUsers: parsedMau } : {}),
	};
	const bom = buildAiBom(facts, context);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ entries: bom.entries, hasRefusal: bom.hasRefusal }, null, 2)}\n`);
		return;
	}
	if (facts.length === 0) {
		process.stdout.write("No loaded models — load the fleet (or point at a running gateway) to render the AI-BOM.\n");
		return;
	}
	process.stdout.write(`${bom.markdown}\n`);
	if (bom.hasRefusal) {
		process.stdout.write("REFUSAL: at least one model is non-compliant for this deployment (see the table).\n");
		process.exitCode = 1;
	}
}
