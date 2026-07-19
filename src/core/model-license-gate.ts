/**
 * F12.100 model provenance, license gate, and AI-BOM — PURE core.
 *
 * License is a real adoption blocker for regulated users, and provenance is table-stakes for !Klein's trust story.
 * This core classifies a fleet model's license family, flags the USAGE TRAPS that bite in production (Llama's
 * 700M-MAU ceiling, its EU multimodal restriction, non-commercial and research-only terms, "open weights" with
 * closed redistribution), decides allow/warn/refuse for a stated deployment context, and renders an AI Bill of
 * Materials (model + version + license + hash) per project.
 *
 * Honesty stance: an UNKNOWN license is never silently treated as permissive — it warns, because "we couldn't
 * tell" is materially different from "it's fine". This core is advisory input to a human/policy decision; it is
 * not legal advice, and the rendered BOM says so.
 */

export type LicenseFamily =
	| "permissive" // Apache-2.0, MIT, BSD — clean commercial use + redistribution
	| "open_weights_restricted" // Llama-family and similar: usable, but with caps/regional carve-outs
	| "non_commercial" // CC-BY-NC, research-only
	| "copyleft" // GPL/AGPL-family obligations
	| "proprietary"
	| "unknown";

export type LicenseVerdict = "allow" | "warn" | "refuse";

export interface ModelLicenseFacts {
	readonly modelKey: string;
	/** SPDX id or free-text license label as published (e.g. "apache-2.0", "llama3.1", "cc-by-nc-4.0"). */
	readonly license: string | null;
	readonly version?: string | null;
	/** Weights hash/digest when known — the provenance anchor in the BOM. */
	readonly hash?: string | null;
}

export interface DeploymentContext {
	/** Commercial use intended (false = personal/research only). */
	readonly commercial: boolean;
	/** Redistributing the weights (bundling/shipping them onward), not merely using them. */
	readonly redistributing: boolean;
	/** Serving users in the EU — relevant to the Llama multimodal carve-out. */
	readonly euDeployment?: boolean;
	/** Monthly active users, when known — the Llama-family 700M ceiling. */
	readonly monthlyActiveUsers?: number | null;
}

export interface LicenseAssessment {
	readonly modelKey: string;
	readonly family: LicenseFamily;
	readonly verdict: LicenseVerdict;
	/** Every concrete trap that applies to THIS deployment, in plain language. */
	readonly concerns: readonly string[];
	readonly reason: string;
}

/** The Llama-family monthly-active-user ceiling above which a separate license must be negotiated. */
const LLAMA_MAU_CEILING = 700_000_000;

const PERMISSIVE = /\b(apache[- ]?2(\.0)?|mit|bsd(-[23])?(-clause)?|isc|unlicense|cc0)\b/i;
const OPEN_WEIGHTS_RESTRICTED = /\b(llama\s?[234](\.\d)?|meta[- ]llama|gemma|command[- ]?r|falcon[- ]?\d*)\b/i;
const NON_COMMERCIAL = /\b(cc[- ]?by[- ]?nc|non[- ]?commercial|research[- ]?only|noncommercial)\b/i;
const COPYLEFT = /\b(a?gpl(-[23](\.\d)?)?|lgpl|mpl[- ]?2)\b/i;
const PROPRIETARY = /\b(proprietary|all rights reserved|commercial license|eula)\b/i;

/** Classify the license label into a family. Absent/blank ⇒ `unknown` (which warns, never silently allows). */
export function classifyLicenseFamily(license: string | null | undefined): LicenseFamily {
	const text = (license ?? "").trim();
	if (text.length === 0) {
		return "unknown";
	}
	if (NON_COMMERCIAL.test(text)) {
		return "non_commercial";
	}
	if (COPYLEFT.test(text)) {
		return "copyleft";
	}
	if (PERMISSIVE.test(text)) {
		return "permissive";
	}
	if (OPEN_WEIGHTS_RESTRICTED.test(text)) {
		return "open_weights_restricted";
	}
	if (PROPRIETARY.test(text)) {
		return "proprietary";
	}
	return "unknown";
}

/**
 * Assess one model against a deployment context. `refuse` is reserved for a stated-intent conflict the license
 * plainly forbids (commercial use of a non-commercial model; redistributing proprietary weights); everything
 * else that merely NEEDS review warns — the operator decides, with the concern named.
 */
export function assessModelLicense(facts: ModelLicenseFacts, context: DeploymentContext): LicenseAssessment {
	const family = classifyLicenseFamily(facts.license);
	const concerns: string[] = [];
	let verdict: LicenseVerdict = "allow";

	const escalate = (next: LicenseVerdict): void => {
		if (next === "refuse" || (next === "warn" && verdict === "allow")) {
			verdict = next;
		}
	};

	switch (family) {
		case "non_commercial":
			if (context.commercial) {
				concerns.push("the license forbids commercial use, but this deployment is commercial");
				escalate("refuse");
			} else {
				concerns.push("non-commercial license — commercial use would require a different model or license");
				escalate("warn");
			}
			break;
		case "proprietary":
			if (context.redistributing) {
				concerns.push("proprietary weights cannot be redistributed");
				escalate("refuse");
			} else {
				concerns.push("proprietary license — check the vendor terms for this deployment");
				escalate("warn");
			}
			break;
		case "copyleft":
			concerns.push("copyleft obligations may extend to derived artifacts — review before shipping");
			escalate("warn");
			break;
		case "open_weights_restricted": {
			if (context.redistributing) {
				concerns.push("open-weights license with redistribution conditions (attribution/naming/use-policy terms)");
				escalate("warn");
			}
			const mau = context.monthlyActiveUsers ?? null;
			if (mau !== null && mau > LLAMA_MAU_CEILING) {
				concerns.push(
					`monthly active users (${mau.toLocaleString()}) exceed the ${LLAMA_MAU_CEILING.toLocaleString()} ceiling — a separate license must be negotiated`,
				);
				escalate("refuse");
			}
			if (context.euDeployment) {
				concerns.push("EU deployment — the Llama-family multimodal carve-out restricts multimodal use in the EU");
				escalate("warn");
			}
			break;
		}
		case "unknown":
			concerns.push("license could not be determined — treat as UNVETTED until confirmed (not assumed permissive)");
			escalate("warn");
			break;
		case "permissive":
			break;
	}

	const reason =
		concerns.length === 0
			? `${facts.modelKey}: ${family} license — clean for this deployment.`
			: `${facts.modelKey}: ${family} license — ${concerns.join("; ")}.`;
	return { modelKey: facts.modelKey, family, verdict, concerns, reason };
}

export interface AiBomEntry extends ModelLicenseFacts {
	readonly family: LicenseFamily;
	readonly verdict: LicenseVerdict;
}

export interface AiBom {
	readonly entries: readonly AiBomEntry[];
	/** True when any model refused for this deployment — the project-level gate signal. */
	readonly hasRefusal: boolean;
	readonly markdown: string;
}

/**
 * Build the project's AI Bill of Materials: every fleet model with version, license family, weights hash, and its
 * verdict for the stated deployment. Unknown fields render as `unknown` rather than being omitted — a BOM that
 * hides gaps is worse than one that shows them.
 */
export function buildAiBom(models: readonly ModelLicenseFacts[], context: DeploymentContext): AiBom {
	const entries: AiBomEntry[] = models.map((facts) => {
		const assessment = assessModelLicense(facts, context);
		return { ...facts, family: assessment.family, verdict: assessment.verdict };
	});
	const rows = entries.map(
		(entry) =>
			`| ${entry.modelKey} | ${entry.version ?? "unknown"} | ${entry.license ?? "unknown"} | ${entry.family} | ${
				entry.hash ?? "unknown"
			} | ${entry.verdict} |`,
	);
	const markdown = [
		"# AI Bill of Materials",
		"",
		`Deployment: ${context.commercial ? "commercial" : "non-commercial"}, ${
			context.redistributing ? "redistributing weights" : "not redistributing weights"
		}${context.euDeployment ? ", EU" : ""}.`,
		"",
		"| Model | Version | License | Family | Hash | Verdict |",
		"| --- | --- | --- | --- | --- | --- |",
		...rows,
		"",
		"_Advisory only — generated from published license labels; not legal advice. `unknown` means unverified, not permissive._",
		"",
	].join("\n");
	return { entries, hasRefusal: entries.some((entry) => entry.verdict === "refuse"), markdown };
}
