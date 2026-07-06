// Minimal stand-in for a runtime-server child, used by shutdown-ipc-hook.integration.test.ts. It preloads the real
// shutdown hook, then installs a SIGINT handler that mimics the server's graceful shutdown. With WEDGE=1 the handler
// swallows SIGINT (simulating a wedged graceful shutdown) so the test can exercise the hook's hard-exit fallback.
require("../shutdown-ipc-hook.cjs");

process.on("SIGINT", () => {
	if (process.env.WEDGE === "1") {
		// Simulate a graceful shutdown that never completes — swallow the signal and never exit on our own.
		return;
	}
	process.exit(0);
});

// One ref'd handle keeps this "server" alive until a shutdown trigger fires (or the hook's hard-exit fallback forces
// us out). WEDGE=1 leaves this running so the fallback timer is what ultimately terminates the process.
const keepAlive = setInterval(() => {}, 1 << 30);
process.on("exit", () => clearInterval(keepAlive));

if (typeof process.send === "function") {
	process.send({ type: "ready" });
}
