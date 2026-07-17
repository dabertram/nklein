/**
 * Single-file edit-thrash detector (F12.15's uncovered detector) — PURE core.
 *
 * The 2026 failure taxonomies name THRASHING — repeatedly editing one file with no net progress — as a recurring
 * agent failure distinct from what !Klein already catches: the turn-loop guard sees repeated identical TOOL CALLS,
 * PRM's `context_thrash` sees growing READ sets, and `ping_pong` sees multi-agent hand-offs. None see an agent
 * oscillating a single file's CONTENT (A → B → A → B …), which burns turns while the diff stays still.
 *
 * Detection is content-state based: fingerprint each edit's resulting content per file; an OSCILLATION is a return
 * to a previously-seen state (the file was edited back to something it already was). Pure — the caller supplies the
 * per-edit path + resulting content (or a precomputed fingerprint).
 */

export interface FileEditRecord {
	readonly path: string;
	/** The file content AFTER the edit (or any stable fingerprint of it). */
	readonly content: string;
}

export type FileThrashVerdict = "ok" | "busy" | "thrashing";

export interface FileThrashFinding {
	readonly path: string;
	readonly edits: number;
	/** Distinct content states seen across the edits. */
	readonly distinctStates: number;
	/** Returns to a previously-seen content state (the thrash signature). */
	readonly oscillations: number;
	readonly verdict: FileThrashVerdict;
	readonly reason: string;
}

export interface EditThrashAssessment {
	readonly findings: readonly FileThrashFinding[];
	/** True when any file is thrashing — the caller nudges/escalates. */
	readonly thrashing: boolean;
}

/** FNV-1a 32-bit — a cheap, dependency-free content fingerprint (collision odds are irrelevant at per-task scale). */
function fingerprint(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export interface EditThrashOptions {
	/** Minimum edits to one file before it can be judged at all. Default 3. */
	readonly minEditsPerFile?: number;
	/** Oscillations at/above which the verdict is `thrashing`. Default 2 (one A→B→A can be a legitimate revert). */
	readonly thrashOscillations?: number;
}

/**
 * Assess the attempt's edit history for single-file thrashing. Per file: `ok` below the edit floor; `thrashing` when
 * content states repeat ≥ the oscillation threshold (edit → revert → re-edit); `busy` when many edits all reach NEW
 * states (steady progress — many edits alone are not a fault).
 */
export function detectEditThrashing(
	edits: readonly FileEditRecord[],
	options: EditThrashOptions = {},
): EditThrashAssessment {
	const minEditsPerFile = options.minEditsPerFile ?? 3;
	const thrashOscillations = options.thrashOscillations ?? 2;
	const byPath = new Map<string, number[]>();
	for (const edit of edits) {
		const list = byPath.get(edit.path) ?? [];
		list.push(fingerprint(edit.content));
		byPath.set(edit.path, list);
	}
	const findings: FileThrashFinding[] = [];
	for (const [path, states] of byPath) {
		const seen = new Set<number>();
		let oscillations = 0;
		for (const state of states) {
			if (seen.has(state)) {
				oscillations++;
			}
			seen.add(state);
		}
		const edits2 = states.length;
		const distinctStates = seen.size;
		let verdict: FileThrashVerdict;
		let reason: string;
		if (edits2 < minEditsPerFile) {
			verdict = "ok";
			reason = `${edits2} edit(s) — below the ${minEditsPerFile}-edit floor.`;
		} else if (oscillations >= thrashOscillations) {
			verdict = "thrashing";
			reason = `${edits2} edits reached only ${distinctStates} distinct states (${oscillations} returns to a previous state) — the file is oscillating, not progressing.`;
		} else {
			verdict = "busy";
			reason = `${edits2} edits, ${distinctStates} distinct states — heavy but progressing.`;
		}
		findings.push({ path, edits: edits2, distinctStates, oscillations, verdict, reason });
	}
	findings.sort((a, b) => b.oscillations - a.oscillations || b.edits - a.edits || a.path.localeCompare(b.path));
	return { findings, thrashing: findings.some((finding) => finding.verdict === "thrashing") };
}
