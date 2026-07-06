// Preloaded via `--require` into a spawned runtime-server child (see test/contract/helpers/backend.ts and the
// integration harnesses). It gives the parent harness a clean IPC shutdown path AND — critically — makes the child
// self-terminate if the parent dies abnormally, so a killed/crashed/timed-out test can't leak an orphaned runtime.
//
// Incident this guards against: 8 orphaned `cli.ts --no-open` servers accumulated over days (parents died without
// sending the shutdown message), each still firing the runtime's periodic timers → recurring CPU spikes + ~4 GB RSS.
// Two triggers now converge on shutdown: the explicit `kanban.shutdown` message AND IPC `disconnect` (parent gone).
// A hard-exit fallback covers the case where the server's graceful shutdown wedges (observed: SIGTERM failed to kill
// the wedged orphans, they needed SIGKILL).

// How long to wait for graceful shutdown before forcing exit. Overridable so tests don't wait the full default.
const HARD_EXIT_FALLBACK_MS = Number.parseInt(process.env.KANBAN_SHUTDOWN_HARD_EXIT_MS ?? "", 10) || 5000;

let shuttingDown = false;

function beginShutdown() {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	// Trigger the server's graceful SIGINT shutdown.
	process.emit("SIGINT");
	// Hard-exit fallback: if the graceful path wedges (never empties the event loop), force exit so we can't linger
	// as an orphan. `.unref()` so a CLEAN shutdown that empties the loop exits on its own without waiting this out.
	setTimeout(() => {
		process.exit(1);
	}, HARD_EXIT_FALLBACK_MS).unref();
}

process.on("message", (message) => {
	if (!message || typeof message !== "object") {
		return;
	}

	if (message.type !== "kanban.shutdown") {
		return;
	}

	beginShutdown();
});

// The parent closed the IPC channel (it exited / was killed / called child.disconnect()). We've been orphaned —
// shut down instead of lingering. Requires an IPC channel in the spawn stdio (all harness spawns use `"ipc"`).
process.on("disconnect", () => {
	beginShutdown();
});
