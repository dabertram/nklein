// P16.7b — the wire contract for the field-report review surface. The response is exactly the review payload
// shape (`renderReviewPayload`): key + layer + the EXACT bytes + what including them reveals. The server sends
// candidates only; inclusion decisions, consent projection, and draft rendering all happen client-side with the
// SAME pure modules the backend tests (web-ui aliases) — so the reviewed bytes cannot drift from the sent bytes.

import { z } from "zod";

export const runtimeFieldReportCandidateSchema = z.object({
	key: z.string(),
	layer: z.enum(["A", "B", "C"]),
	bytes: z.string(),
	reveals: z.string(),
});

export const runtimeFieldReportCandidatesResponseSchema = z.object({
	candidates: z.array(runtimeFieldReportCandidateSchema),
});

export type RuntimeFieldReportCandidatesResponse = z.infer<typeof runtimeFieldReportCandidatesResponseSchema>;
