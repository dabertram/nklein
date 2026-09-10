/**
 * Which slice of the HITL rig's request queue belongs to ONE dev-test project.
 *
 * ── WHY ──
 * A capture is a range of request ids. `scripts/hitl-record-project.mts mark` writes the LOWER bound before a
 * project is seeded, and that half of the problem has been solved since the marks existed. The upper bound was
 * left implicit as "whatever the queue has reached by the time you run `record`", which is correct only if
 * `record` runs immediately after that project's drive and nothing else ever drives afterwards.
 *
 * Neither holds. Live 2026-09-10, the rig's queue at request 1775 shows project 45's decompose starting while
 * requests 1766-1774 are still project 44's cards draining; and the recording-marks directory holds 31 projects
 * (46-76) all stamped mark 1405 by a run that was burned by an unreachable runtime. Re-recording any earlier
 * project today would therefore capture every project driven since — an unbounded window silently swallows the
 * REST OF HISTORY, which is the same failure the lower bound was invented to prevent, pointing the other way.
 *
 * The next project's mark is exactly where this project's traffic stops being the only thing in the queue, so it
 * is the upper bound. With both bounds written down, a recording is reproducible from the queue long after the
 * drive — which is what makes repairing a bad capture possible at all, instead of re-driving for hours.
 *
 * Note what this deliberately does NOT do: it does not try to identify a project's traffic by NAME. Card ids are
 * chosen by the model, not derived from the project — project 41's cards are all named
 * `kill-mutant-m1-the-bound-on-the-attempt-loop-*` with no trace of `async-retry-concurrency-suite` in them — so
 * any slug-matching filter would discard a project's own work. Ids bound the window; only genuinely cross-project
 * task families (the main-branch custodian) are filtered by name, and that is done in the capture script.
 */
export interface RecordingMark {
	projectId: string;
	/** The queue's high-water mark at the instant this project was seeded. Its traffic starts strictly above it. */
	mark: number;
}

export interface CaptureWindow {
	/** Exclusive lower bound: this project's own mark. */
	from: number;
	/** Inclusive upper bound. */
	to: number;
	/**
	 * What set the upper bound — the project seeded next, or the end of the queue when this is the latest drive.
	 * Worth reporting: a window closed by a later project is final, while one closed by the queue's high-water
	 * mark grows every time the rig answers another request.
	 */
	boundedBy: { kind: "next-project"; projectId: string } | { kind: "queue-high-water" };
}

/**
 * The id range that is this project's drive, given every mark the rig has written and where the queue stands now.
 *
 * Throws when the project has no mark: a capture that cannot say where it begins would record the previous run
 * under this project's name, and guessing is exactly the failure the marks exist to prevent.
 */
export function resolveCaptureWindow(input: {
	marks: readonly RecordingMark[];
	projectId: string;
	queueHighWaterMark: number;
}): CaptureWindow {
	const own = input.marks.find((candidate) => candidate.projectId === input.projectId);
	if (!own) {
		throw new Error(
			`no recording mark for ${input.projectId} — a capture cannot know where this project's traffic begins`,
		);
	}
	// Strictly greater: projects sharing a mark (a burned run stamps many at once) bound nothing for each other.
	const next = input.marks
		.filter((candidate) => candidate.projectId !== input.projectId && candidate.mark > own.mark)
		.sort((left, right) => left.mark - right.mark)[0];
	if (next && next.mark <= input.queueHighWaterMark) {
		return { from: own.mark, to: next.mark, boundedBy: { kind: "next-project", projectId: next.projectId } };
	}
	return { from: own.mark, to: input.queueHighWaterMark, boundedBy: { kind: "queue-high-water" } };
}
