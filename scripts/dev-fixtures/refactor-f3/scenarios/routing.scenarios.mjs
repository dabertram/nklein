/**
 * The routing behaviour this refactor must preserve, exactly. FROZEN: evidence, not workspace.
 *
 * The rules are asserted as the brief states them, one decision at a time, so a restructuring that quietly changes
 * a precedence is caught by the scenario that owns that precedence rather than by a wall of snapshots.
 */

const subscriber = (over = {}) => ({ id: "s-1", email: "person@example.com", verified: true, ...over });

export const scenarios = [
	{
		id: "B01",
		title: "a security alert prefers a verified phone, then email, then nothing",
		entry: "routeNotification",
		assert: (route, assert) => {
			assert.equal(route({ kind: "security_alert" }, subscriber({ phone: "+100" })).channel, "sms");
			// Unverified phone does not count: the fallback is email.
			assert.equal(route({ kind: "security_alert" }, subscriber({ phone: "+100", verified: false })).channel, "email");
			assert.equal(route({ kind: "security_alert" }, subscriber()).channel, "email");
			const none = route({ kind: "security_alert" }, subscriber({ email: undefined }));
			assert.equal(none.channel, null);
			assert.match(none.reason, /security alert/u);
		},
	},
	{
		id: "B02",
		title: "billing only ever goes to email",
		entry: "routeNotification",
		assert: (route, assert) => {
			assert.equal(route({ kind: "billing" }, subscriber({ phone: "+100", pushToken: "t" })).channel, "email");
			assert.equal(route({ kind: "billing" }, subscriber({ email: undefined, pushToken: "t" })).channel, null);
		},
	},
	{
		id: "B03",
		title: "quiet hours suppress mentions and digests, and nothing else",
		entry: "routeNotification",
		assert: (route, assert) => {
			const quiet = subscriber({ quietHours: true, pushToken: "t", webhookUrl: "https://x", phone: "+100" });
			assert.equal(route({ kind: "mention" }, quiet).channel, null);
			assert.equal(route({ kind: "digest" }, quiet).channel, null);
			// A security alert and a bill are not suppressed by quiet hours.
			assert.equal(route({ kind: "security_alert" }, quiet).channel, "sms");
			assert.equal(route({ kind: "billing" }, quiet).channel, "email");
		},
	},
	{
		id: "B04",
		title: "mentions prefer push, digests prefer a webhook, both fall back to email",
		entry: "routeNotification",
		assert: (route, assert) => {
			assert.equal(route({ kind: "mention" }, subscriber({ pushToken: "t", webhookUrl: "https://x" })).channel, "push");
			assert.equal(route({ kind: "digest" }, subscriber({ pushToken: "t", webhookUrl: "https://x" })).channel, "webhook");
			assert.equal(route({ kind: "mention" }, subscriber()).channel, "email");
			assert.equal(route({ kind: "digest" }, subscriber()).channel, "email");
			assert.equal(route({ kind: "mention" }, subscriber({ email: undefined })).channel, null);
		},
	},
	{
		id: "B05",
		title: "an unknown event kind routes nowhere and says so by name",
		entry: "routeNotification",
		assert: (route, assert) => {
			const result = route({ kind: "sms_blast" }, subscriber({ pushToken: "t" }));
			assert.equal(result.channel, null);
			assert.match(result.reason, /sms_blast/u);
		},
	},
	{
		id: "B06",
		title: "malformed input is rejected, not routed",
		entry: "routeNotification",
		assert: (route, assert) => {
			assert.throws(() => route(null, subscriber()), TypeError);
			assert.throws(() => route({}, subscriber()), TypeError);
			assert.throws(() => route({ kind: "billing" }, null), TypeError);
			assert.throws(() => route({ kind: "billing" }, { email: "a@b.c" }), TypeError);
		},
	},
	{
		id: "B07",
		title: "every result carries the subscriber id and a reachability summary in channel-precedence order",
		entry: "routeNotification",
		assert: (route, assert) => {
			const rich = subscriber({ id: "s-9", phone: "+100", pushToken: "t", webhookUrl: "https://x" });
			assert.deepEqual(route({ kind: "digest" }, rich), {
				channel: "webhook",
				reason: "digests prefer a webhook",
				subscriberId: "s-9",
				reachableSummary: "sms|push|webhook|email",
			});
			assert.equal(route({ kind: "billing" }, subscriber({ email: undefined })).reachableSummary, "none");
		},
	},
	{
		id: "B08",
		title: "the audit reports the same reachability the router does",
		entry: "auditRoutability",
		assert: async (auditRoutability, assert) => {
			const { routeNotification } = await import("../src/index.mjs");
			const rich = subscriber({ id: "s-9", phone: "+100", pushToken: "t", webhookUrl: "https://x" });
			const audited = auditRoutability(rich);
			assert.equal(audited.reachableSummary, routeNotification({ kind: "billing" }, rich).reachableSummary);
			assert.equal(audited.reachableCount, 4);
			assert.throws(() => auditRoutability(null), TypeError);
		},
	},
	{
		id: "B09",
		title: "routeAll routes each subscriber independently",
		entry: "routeAll",
		assert: (routeAll, assert) => {
			const results = routeAll({ kind: "mention" }, [
				subscriber({ id: "a", pushToken: "t" }),
				subscriber({ id: "b", quietHours: true }),
			]);
			assert.deepEqual(
				results.map((result) => [result.subscriberId, result.channel]),
				[
					["a", "push"],
					["b", null],
				],
			);
			assert.deepEqual(routeAll({ kind: "mention" }, undefined), []);
		},
	},
];
