/**
 * The IO seam.
 *
 * Everything in this service that would otherwise reach for a timer, a socket or a disk goes through an injected
 * `io` object with a single method, `yield()`, which resolves when the simulated IO turn is over. Production passes
 * `immediateIo`; a test passes one it can step by hand. Nothing here — and nothing that uses it — may read the
 * clock or sleep.
 */

export const immediateIo = {
	yield() {
		return Promise.resolve();
	},
};
