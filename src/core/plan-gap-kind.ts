import { z } from "zod";

/**
 * The plan-gap kind enum + type, kept in a **browser-safe** module (zod only, no Node imports) so the contract
 * (`api-contract.ts`, bundled into the web-ui) can reference it WITHOUT pulling in `plan-gap.ts`'s telemetry chain
 * (`recordSelfObservation` → `self-observation-sink` → `node:path`/`fs`/`os`/`crypto`), which breaks the browser build.
 */
export const planGapKindSchema = z.enum([
	"missing_decision",
	"contradictory_requirement",
	"missing_dependency",
	"scope_too_large",
	"integration_needed",
	"other",
]);
export type PlanGapKind = z.infer<typeof planGapKindSchema>;
