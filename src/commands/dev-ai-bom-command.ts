import { createDefaultLmsRunner, fetchLmsPsModelsCached } from "../core/lms-ps-json";
import {
	applyLicenseDeclarations,
	parseLicenseDeclarations,
	renderProvenanceNote,
} from "../core/model-license-declaration";
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
	// F12.100 (data half): the gateway publishes no license field, so licenses come from an OPERATOR DECLARATION
	// in `NKLEIN_MODEL_LICENSES` (format: `key-or-prefix*=license[;note]`, comma-separated). Undeclared models stay
	// null ⇒ unknown ⇒ warn. We never infer a license from a model NAME: "llama" in an id is not evidence of the
	// Llama licence, and fabricated compliance data is worse than an honest "unverified".
	const declarations = parseLicenseDeclarations(process.env.NKLEIN_MODEL_LICENSES);
	const factsWithProvenance = applyLicenseDeclarations(
		models.map((model) => ({ modelKey: model.modelKey || model.identifier, version: null, hash: null })),
		declarations,
	);
	const facts: ModelLicenseFacts[] = factsWithProvenance;
	const parsedMau = options.mau === undefined ? Number.NaN : Number.parseInt(options.mau, 10);
	const context: DeploymentContext = {
		commercial: options.commercial === true,
		redistributing: options.redistributing === true,
		...(options.eu === true ? { euDeployment: true } : {}),
		...(Number.isFinite(parsedMau) ? { monthlyActiveUsers: parsedMau } : {}),
	};
	const bom = buildAiBom(facts, context);
	const provenanceNote = renderProvenanceNote(factsWithProvenance);
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					entries: bom.entries.map((entry, index) => ({
						...entry,
						provenance: factsWithProvenance[index]?.provenance ?? "unknown",
					})),
					hasRefusal: bom.hasRefusal,
					provenanceNote,
				},
				null,
				2,
			)}\n`,
		);
		return;
	}
	if (facts.length === 0) {
		process.stdout.write("No loaded models — load the fleet (or point at a running gateway) to render the AI-BOM.\n");
		return;
	}
	process.stdout.write(`${bom.markdown}\n`);
	// The provenance note is NOT optional decoration: without it a reader cannot tell an operator's claim from a
	// verified fact, which is exactly the distinction the declaration mechanism exists to preserve.
	process.stdout.write(`\nPROVENANCE: ${provenanceNote}\n`);
	if (bom.hasRefusal) {
		process.stdout.write("REFUSAL: at least one model is non-compliant for this deployment (see the table).\n");
		process.exitCode = 1;
	}
}
