/**
 * Result-handle scheme for small-model context frugality (todo §5.O "Result handles").
 *
 * When a tool's bulk output (e.g. a long file listing, a diff, a search result set) would flood a small model's
 * context window, the tool instead returns a compact `result://<tool>/<id>` URI — a *result handle* — and stores
 * the real value in a lightweight in-process store. The model may ignore the handle (it only needs to know "something
 * was produced"), or it may fetch the value through a resolver only when it genuinely needs the content. This keeps
 * the occupied context small by default (§5.O prime directive: ≥32k context floor for small models).
 *
 * The scheme is intentionally minimal:
 *   - No TTL, eviction, or persistence — the store is ephemeral per agent session.
 *   - IDs are monotonically incrementing integers (as strings) so a human reading a transcript can follow them.
 *   - The tool name in the URI makes handles self-describing in logs / traces.
 */

/** The URI scheme prefix used for all result handles. */
const RESULT_SCHEME = "result://";

/**
 * Format a result handle URI from a tool name and a store-generated id.
 *
 * @example
 *   formatResultHandle("file-search", "3") // → "result://file-search/3"
 */
export function formatResultHandle(tool: string, id: string): string {
	return `${RESULT_SCHEME}${tool}/${id}`;
}

/**
 * Parse a result handle URI, returning `{ tool, id }` on success or `null` on any mismatch.
 *
 * Accepts surrounding whitespace (trims before parsing). Rejects:
 *   - Wrong scheme (anything other than `result://`).
 *   - Missing, empty, or multi-segment tool name (only one `/` separator is expected after the authority).
 *   - Empty id.
 */
export function parseResultHandle(handle: string): { tool: string; id: string } | null {
	const trimmed = handle.trim();
	if (!trimmed.startsWith(RESULT_SCHEME)) {
		return null;
	}
	const rest = trimmed.slice(RESULT_SCHEME.length);
	const slashIndex = rest.indexOf("/");
	if (slashIndex === -1) {
		return null;
	}
	const tool = rest.slice(0, slashIndex);
	const id = rest.slice(slashIndex + 1);
	if (tool.length === 0 || id.length === 0) {
		return null;
	}
	// Reject any extra path segments (e.g. "result://tool/id/extra") — only tool + id are valid.
	if (id.includes("/")) {
		return null;
	}
	return { tool, id };
}

/**
 * An in-memory store that maps result handles to their underlying values.
 *
 * Implementations are expected to be single-session, ephemeral objects — do not serialize or share across sessions.
 */
export interface ResultHandleStore {
	/**
	 * Store `value` under a freshly generated handle for `tool` and return that handle.
	 * IDs are monotonically increasing integers (as strings) scoped to this store instance.
	 */
	put(tool: string, value: unknown): string;

	/**
	 * Retrieve the value for a handle previously returned by `put`, or `undefined` when the handle is unknown,
	 * unparseable, or belongs to a different store's id space.
	 */
	get(handle: string): unknown | undefined;

	/** Return `true` when the handle is known to this store (i.e. `get` would return a value). */
	has(handle: string): boolean;
}

/**
 * Create a new in-memory `ResultHandleStore` backed by a plain `Map`.
 *
 * - `put` generates a monotonically increasing id (starting at "1") per store instance, stores the value, and
 *   returns the formatted handle.
 * - `get` and `has` parse the handle with `parseResultHandle` and look up the id in the map; an unparseable or
 *   unknown handle returns `undefined` / `false` respectively.
 *
 * The store is intentionally unsynchronised — callers that fan out across concurrent agents should use one store
 * per agent or coordinate externally (§5.O per-session isolation).
 */
export function createResultHandleStore(): ResultHandleStore {
	const store = new Map<string, unknown>();
	let counter = 0;

	return {
		put(tool: string, value: unknown): string {
			counter += 1;
			const id = String(counter);
			const handle = formatResultHandle(tool, id);
			store.set(handle, value);
			return handle;
		},

		get(handle: string): unknown | undefined {
			const parsed = parseResultHandle(handle);
			if (parsed === null) {
				return undefined;
			}
			return store.get(handle);
		},

		has(handle: string): boolean {
			const parsed = parseResultHandle(handle);
			if (parsed === null) {
				return false;
			}
			return store.has(handle);
		},
	};
}
