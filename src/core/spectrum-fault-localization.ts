/**
 * §5.AK / §5.B — spectrum-based fault localization (SBFL, pure core). When a bug has tests, coverage SPECTRA rank the
 * suspects: a program element (file/function/line) executed by many FAILING tests and few PASSING ones is likely the
 * fault. This computes the Ochiai suspiciousness — the standard, empirically-strong SBFL metric — for each element and
 * ranks them most-suspicious first, giving the repair kernel's localize step a coverage-driven prior when tests exist.
 *
 *   Ochiai(e) = failed(e) / sqrt(totalFailed × (failed(e) + passed(e)))
 *
 * where failed(e)/passed(e) are the failing/passing tests that EXECUTE e. An element no failing test touches scores 0
 * (not the fault — the bug reproduces via the failing tests). Pure + total + deterministic.
 */

/** Per-element coverage spectrum: how many failing vs passing tests execute this element. */
export interface ElementSpectrum {
	/** The program element (e.g. `file:symbol` or `file:line`). */
	ref: string;
	/** Number of FAILING tests that execute this element. */
	failedCovering: number;
	/** Number of PASSING tests that execute this element. */
	passedCovering: number;
}

export interface SpectrumLocalizationInput {
	/** Total failing tests in the run. */
	totalFailing: number;
	/** Total passing tests in the run. */
	totalPassing: number;
	elements: readonly ElementSpectrum[];
}

export interface SuspectRanking {
	ref: string;
	/** Ochiai suspiciousness in [0,1]; higher = more suspicious. */
	suspiciousness: number;
}

const nonNeg = (value: number): number => Math.max(0, Math.trunc(value));

/** The Ochiai suspiciousness of one element given the total failing-test count. Returns 0 when undefined (÷0). */
export function ochiaiSuspiciousness(element: ElementSpectrum, totalFailing: number): number {
	const failed = nonNeg(element.failedCovering);
	const passed = nonNeg(element.passedCovering);
	const totalFailed = nonNeg(totalFailing);
	if (failed === 0) {
		return 0; // no failing test touches it ⇒ not the fault
	}
	const denominator = Math.sqrt(totalFailed * (failed + passed));
	return denominator === 0 ? 0 : failed / denominator;
}

/**
 * Rank suspects most-suspicious-first (pure). Ties (equal suspiciousness) keep input order — a stable sort — so the
 * ranking is deterministic. Elements with suspiciousness 0 are still returned (the caller decides a cutoff).
 */
export function rankSpectrumSuspects(input: SpectrumLocalizationInput): SuspectRanking[] {
	return input.elements
		.map((element, index) => ({
			ref: element.ref,
			suspiciousness: ochiaiSuspiciousness(element, input.totalFailing),
			index,
		}))
		.sort((a, b) => b.suspiciousness - a.suspiciousness || a.index - b.index)
		.map(({ ref, suspiciousness }) => ({ ref, suspiciousness }));
}
