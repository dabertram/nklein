/**
 * Smart-zone context arrangement (todo §5.AD) — order assembled context for where models actually attend.
 *
 * Research (full notes + citations: `docs/research/context-smart-zone-and-reasoning-research.md`): LLM attention is
 * **U-shaped** — the **start** and **end** of the context are used best, the **middle** worst ("lost in the middle",
 * Liu et al. 2023; partly architectural). Attention is also **causal**, so the earliest tokens can't attend to
 * background that appears later — the model only has the full picture **near the end**. And over-filling a window
 * degrades output even below the limit ("context rot"). Anthropic's guidance follows directly: put **durable framing
 * FRONT**, **bulk reference in the MIDDLE**, and the **concrete task/question LAST** (the strong end-zone, after the
 * background has "arrived"); delimit sections; keep it tight.
 *
 * This module is the pure ordering policy. It only **reorders + tags** parts — it never adds content, so it can't
 * violate the never-overflow guard (§6.2); trimming to a budget is a separate concern. Per-model knobs (the §5.AA
 * `ModelBehaviorProfile`) can later override the defaults; absent a profile, the research baseline applies.
 */

/**
 * Which zone a piece of context wants:
 * - `front` — durable framing the model should anchor on (role, hard invariants, tool contract).
 * - `middle` — bulk reference the model consults but that isn't the load-bearing instruction (repo map, long files,
 *   older history). The genuinely critical fact must never live in the dead center, so `middle` parts are edge-loaded.
 * - `back` — the concrete task / acceptance / current step / question. Goes last, in the strongest end-zone.
 */
export type SmartZoneBand = "front" | "middle" | "back";

export interface SmartZonePart {
	/** Stable label for the part — also the delimiter tag when `tagParts` is on. */
	id: string;
	band: SmartZoneBand;
	content: string;
	/** Relevance/importance within the band (default 0). Higher = placed nearer the strong zones + kept when trimming. */
	priority?: number;
}

export interface ArrangeSmartZoneOptions {
	/**
	 * Edge-load the `middle` band: place higher-priority middle parts nearest the strong front/back zones and push the
	 * lowest-priority (most distractor-like) material into the dead center. Default true — the research-driven placement.
	 */
	edgeLoadMiddle?: boolean;
}

const DEFAULT_PRIORITY = 0;

function priorityOf(part: SmartZonePart): number {
	return part.priority ?? DEFAULT_PRIORITY;
}

/** Stable sort by priority descending (preserves input order among equal priorities). */
function byPriorityDesc(parts: readonly SmartZonePart[]): SmartZonePart[] {
	return parts
		.map((part, index) => ({ part, index }))
		.sort((a, b) => priorityOf(b.part) - priorityOf(a.part) || a.index - b.index)
		.map((entry) => entry.part);
}

/**
 * Edge-load: given parts sorted by priority descending, place them outward-in so the highest-priority items sit at the
 * two edges (adjacent to the strong front/back zones) and the lowest-priority sit in the dead center.
 * e.g. [p1>=p2>=p3>=p4>=p5] → [p1, p3, p5, p4, p2].
 */
function edgeLoad(sortedDesc: readonly SmartZonePart[]): SmartZonePart[] {
	const frontHalf: SmartZonePart[] = [];
	const backHalf: SmartZonePart[] = [];
	sortedDesc.forEach((part, index) => {
		if (index % 2 === 0) {
			frontHalf.push(part);
		} else {
			backHalf.push(part);
		}
	});
	backHalf.reverse();
	return [...frontHalf, ...backHalf];
}

/**
 * Arrange context parts for the model's smart zone: `front` framing first (highest priority nearest the very front),
 * `middle` reference next (edge-loaded by default so critical items avoid the dead center), then `back` task content
 * last (highest priority nearest the very end). Empty/blank parts are dropped. Pure — input is never mutated.
 */
export function arrangeContextForSmartZone(
	parts: readonly SmartZonePart[],
	options: ArrangeSmartZoneOptions = {},
): SmartZonePart[] {
	const nonEmpty = parts.filter((part) => part.content.trim().length > 0);
	const front = byPriorityDesc(nonEmpty.filter((part) => part.band === "front"));
	const middleDesc = byPriorityDesc(nonEmpty.filter((part) => part.band === "middle"));
	const middle = options.edgeLoadMiddle === false ? middleDesc : edgeLoad(middleDesc);
	// `back` is ordered so the HIGHEST-priority task content lands LAST (the very end = strongest position).
	const back = byPriorityDesc(nonEmpty.filter((part) => part.band === "back")).reverse();
	return [...front, ...middle, ...back];
}

export interface RenderSmartZoneOptions extends ArrangeSmartZoneOptions {
	/** Wrap each part as `<id>\n…\n</id>` (Anthropic: tag-delimit sections so the model knows each block's purpose). */
	tagParts?: boolean;
	/** Separator between rendered parts. Default a blank line. */
	separator?: string;
}

/** Convenience: arrange then join into a single string, optionally tag-delimiting each part. */
export function renderSmartZoneContext(parts: readonly SmartZonePart[], options: RenderSmartZoneOptions = {}): string {
	const arranged = arrangeContextForSmartZone(parts, options);
	const separator = options.separator ?? "\n\n";
	return arranged
		.map((part) => {
			const body = part.content.trim();
			return options.tagParts ? `<${part.id}>\n${body}\n</${part.id}>` : body;
		})
		.join(separator);
}
