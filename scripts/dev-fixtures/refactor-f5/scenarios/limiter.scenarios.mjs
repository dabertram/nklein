/**
 * The rate-limiter behaviour this refactor must preserve, exactly. FROZEN: evidence, not workspace.
 *
 * Every scenario controls time through `setClock`, so nothing here depends on wall time and a scenario cannot pass
 * or fail for being slow.
 */

async function fresh(over = {}) {
	const api = await import("../src/index.mjs");
	let now = 1000;
	api.setClock(() => now);
	api.reset();
	api.clearDenials();
	api.configure({ windowMs: 100, max: 2, ...over });
	return { api, at: (value) => { now = value; }, now: () => now };
}

export const scenarios = [
	{
		id: "B01",
		title: "a window allows `max` calls and then denies, reporting the remaining allowance",
		entry: "allow",
		assert: async (_allow, assert) => {
			const { api } = await fresh();
			assert.deepEqual(api.allow("a"), { allowed: true, remaining: 1, resetAt: 1100 });
			assert.deepEqual(api.allow("a"), { allowed: true, remaining: 0, resetAt: 1100 });
			assert.deepEqual(api.allow("a"), { allowed: false, remaining: 0, resetAt: 1100 });
			assert.deepEqual(api.allow("a"), { allowed: false, remaining: 0, resetAt: 1100 });
		},
	},
	{
		id: "B02",
		title: "the window is fixed from the first hit and resets only at resetAt",
		entry: "allow",
		assert: async (_allow, assert) => {
			const { api, at } = await fresh();
			api.allow("a");
			api.allow("a");
			at(1099);
			assert.equal(api.allow("a").allowed, false);
			// resetAt is inclusive: at exactly resetAt the window is new.
			at(1100);
			assert.deepEqual(api.allow("a"), { allowed: true, remaining: 1, resetAt: 1200 });
		},
	},
	{
		id: "B03",
		title: "keys are counted independently",
		entry: "allow",
		assert: async (_allow, assert) => {
			const { api } = await fresh();
			api.allow("a");
			api.allow("a");
			assert.equal(api.allow("a").allowed, false);
			assert.deepEqual(api.allow("b"), { allowed: true, remaining: 1, resetAt: 1100 });
		},
	},
	{
		id: "B04",
		title: "configure merges into the current settings and returns them; currentConfig is a copy",
		entry: "configure",
		assert: async (_configure, assert) => {
			const { api } = await fresh();
			assert.deepEqual(api.configure({ max: 3 }), { windowMs: 100, max: 3 });
			assert.deepEqual(api.currentConfig(), { windowMs: 100, max: 3 });
			assert.deepEqual(api.configure(), { windowMs: 100, max: 3 });
			assert.deepEqual(api.configure(undefined), { windowMs: 100, max: 3 });
			const snapshot = api.currentConfig();
			snapshot.max = 99;
			assert.equal(api.currentConfig().max, 3, "currentConfig must hand out a copy, not the live settings");
		},
	},
	{
		id: "B05",
		title: "a new limit applies to the windows that follow, not retroactively",
		entry: "allow",
		assert: async (_allow, assert) => {
			const { api, at } = await fresh();
			api.allow("a");
			api.allow("a");
			api.configure({ max: 4 });
			// The existing window has 2 hits and the new max is 4, so two more are allowed inside it.
			assert.deepEqual(api.allow("a"), { allowed: true, remaining: 1, resetAt: 1100 });
			at(1200);
			assert.deepEqual(api.allow("a"), { allowed: true, remaining: 3, resetAt: 1300 });
		},
	},
	{
		id: "B06",
		title: "reset clears the counters but not the settings",
		entry: "reset",
		assert: async (_reset, assert) => {
			const { api } = await fresh();
			api.allow("a");
			api.allow("a");
			assert.equal(api.allow("a").allowed, false);
			api.reset();
			assert.deepEqual(api.allow("a"), { allowed: true, remaining: 1, resetAt: 1100 });
			assert.deepEqual(api.currentConfig(), { windowMs: 100, max: 2 });
		},
	},
	{
		id: "B07",
		title: "a denial is logged with the key, the time, and the limits in force at that moment",
		entry: "denials",
		assert: async (_denials, assert) => {
			const { api, at } = await fresh();
			api.allow("a");
			api.allow("a");
			api.allow("a"); // denied under max 2
			// A NEW window under a TIGHTER limit: the record must carry the limits in force then, not the ones now.
			at(1200);
			api.configure({ max: 1 });
			assert.equal(api.allow("a").allowed, true);
			assert.equal(api.allow("a").allowed, false);
			assert.deepEqual(api.denials(), [
				{ key: "a", atMs: 1000, max: 2, windowMs: 100 },
				{ key: "a", atMs: 1200, max: 1, windowMs: 100 },
			]);
		},
	},
	{
		id: "B08",
		title: "denials() hands out copies, and clearDenials empties the log",
		entry: "denials",
		assert: async (_denials, assert) => {
			const { api } = await fresh();
			api.allow("a");
			api.allow("a");
			api.allow("a");
			const first = api.denials();
			first[0].key = "tampered";
			assert.equal(api.denials()[0].key, "a", "denials() must hand out copies, not the live entries");
			api.clearDenials();
			assert.deepEqual(api.denials(), []);
		},
	},
	{
		id: "B09",
		title: "a missing or empty key is rejected, and setClock(nothing) restores real time",
		entry: "allow",
		assert: async (_allow, assert) => {
			const { api } = await fresh();
			assert.throws(() => api.allow(""), TypeError);
			assert.throws(() => api.allow(undefined), TypeError);
			assert.throws(() => api.allow(42), TypeError);
			api.setClock(undefined);
			const before = Date.now();
			const result = api.allow("real");
			assert.ok(result.resetAt >= before + 100, "a restored clock must be real time again");
		},
	},
];
