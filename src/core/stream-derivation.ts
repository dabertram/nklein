/**
 * §5.AU STEP 2 — derive STREAMS (epics) from the board's existing structure. Pure + deterministic: given the cards (each
 * carrying its decomposition provenance `planSlug` from `generatedFromPlan`) + the board `dependsOn` edges, propose one
 * stream per decomposition (all cards sharing a `planSlug`) and, for the remainder, one stream per multi-card
 * `dependsOn`-connected component. Singletons stay ungrouped. Deterministic stream ids (`stream-<slug>` /
 * `stream-dep-<rootId>`) make re-derivation idempotent — the same board yields the same ids, so nothing churns.
 *
 * Manual membership (a user's `set_card_stream`) is NOT this core's concern: it is applied at the store as an override
 * on top of this auto-derivation (`effectiveStreamId = manualStreamId ?? derived`), keeping this function a pure,
 * side-effect-free proposal over the board's intrinsic structure. Timestamps + the persisted `RuntimeStream` record are
 * the store's job too — this returns only the grouping + the minimal stream metadata.
 */

/** A card as seen by the derivation: its id, title (for naming), and decomposition provenance slug (if any). */
export interface StreamDerivationCard {
	id: string;
	title: string;
	/** `generatedFromPlan.planSlug` — cards sharing this were spawned from one decomposition = one stream. */
	planSlug?: string | null;
}

/** A board dependency edge (`fromTaskId` depends on / links to `toTaskId`). */
export interface StreamDependency {
	fromTaskId: string;
	toTaskId: string;
}

/** A proposed stream (the store materializes it into a persisted `RuntimeStream` with timestamps). */
export interface DerivedStream {
	id: string;
	title: string;
	source: "decomposition" | "dependency";
	/** Back-link to the seeding decomposition slug (only for `decomposition` streams). */
	planSlug?: string;
}

export interface DeriveStreamsInput {
	cards: readonly StreamDerivationCard[];
	dependencies: readonly StreamDependency[];
}

export interface DeriveStreamsResult {
	streams: readonly DerivedStream[];
	/** cardId → streamId, only for cards that landed in a stream (singletons are absent). */
	cardStreamId: Readonly<Record<string, string>>;
}

/** Humanize a slug/id into a stream title: hyphen/underscore → space, first letters upper-cased. */
function titleFromSlug(slug: string): string {
	const words = slug.replace(/[-_]+/g, " ").trim();
	return words.length > 0 ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : slug;
}

/** Union-find (disjoint set) over card ids, with a deterministic representative = the lexicographically smallest id. */
class DisjointSet {
	private readonly parent = new Map<string, string>();

	find(id: string): string {
		const p = this.parent.get(id);
		if (p === undefined) {
			this.parent.set(id, id);
			return id;
		}
		if (p === id) {
			return id;
		}
		const root = this.find(p);
		this.parent.set(id, root);
		return root;
	}

	union(a: string, b: string): void {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra === rb) {
			return;
		}
		// Keep the lexicographically smaller id as the root so the derived id is stable regardless of edge order.
		const [root, child] = ra < rb ? [ra, rb] : [rb, ra];
		this.parent.set(child, root);
	}
}

/**
 * Derive the streams + card→stream membership from the board. Pure, deterministic, idempotent. Order of `cards` /
 * `dependencies` does not affect the result (streams are keyed by slug / lexicographically-smallest component id).
 */
export function deriveStreams(input: DeriveStreamsInput): DeriveStreamsResult {
	const streams: DerivedStream[] = [];
	const cardStreamId: Record<string, string> = {};
	const seenStreamIds = new Set<string>();

	// 1. Decomposition streams — one per distinct planSlug.
	const bySlug = new Map<string, StreamDerivationCard[]>();
	for (const card of input.cards) {
		const slug = card.planSlug?.trim();
		if (slug) {
			const group = bySlug.get(slug) ?? [];
			group.push(card);
			bySlug.set(slug, group);
		}
	}
	// Deterministic stream order: by slug.
	for (const slug of [...bySlug.keys()].sort()) {
		const streamId = `stream-${slug}`;
		if (!seenStreamIds.has(streamId)) {
			streams.push({ id: streamId, title: titleFromSlug(slug), source: "decomposition", planSlug: slug });
			seenStreamIds.add(streamId);
		}
		for (const card of bySlug.get(slug) ?? []) {
			cardStreamId[card.id] = streamId;
		}
	}

	// 2. Dependency streams — connected components among the STILL-UNGROUPED cards.
	const ungrouped = new Set(input.cards.filter((c) => cardStreamId[c.id] === undefined).map((c) => c.id));
	if (ungrouped.size > 0) {
		const ds = new DisjointSet();
		for (const edge of input.dependencies) {
			// Only union edges whose BOTH endpoints are ungrouped cards (a decomposition stream already owns the rest).
			if (ungrouped.has(edge.fromTaskId) && ungrouped.has(edge.toTaskId)) {
				ds.union(edge.fromTaskId, edge.toTaskId);
			}
		}
		const components = new Map<string, string[]>();
		for (const id of ungrouped) {
			const root = ds.find(id);
			const members = components.get(root) ?? [];
			members.push(id);
			components.set(root, members);
		}
		const titleById = new Map(input.cards.map((c) => [c.id, c.title]));
		// Deterministic order: by root id.
		for (const root of [...components.keys()].sort()) {
			const members = components.get(root) ?? [];
			if (members.length < 2) {
				continue; // a lone card is not a stream.
			}
			const streamId = `stream-dep-${root}`;
			streams.push({ id: streamId, title: titleFromSlug(titleById.get(root) ?? root), source: "dependency" });
			for (const id of members) {
				cardStreamId[id] = streamId;
			}
		}
	}

	return { streams, cardStreamId };
}
