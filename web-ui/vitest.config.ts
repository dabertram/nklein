import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootPkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8")) as { version: string };

export default defineConfig({
	plugins: [react()],
	define: {
		__APP_VERSION__: JSON.stringify(rootPkg.version),
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@runtime-contract": resolve(__dirname, "../src/core/api-contract.ts"),
			"@runtime-agent-catalog": resolve(__dirname, "../src/core/agent-catalog.ts"),
			"@runtime-clarification-option-set": resolve(__dirname, "../src/core/clarification-option-set.ts"),
			"@runtime-focus-chain": resolve(__dirname, "../src/core/focus-chain.ts"),
			"@runtime-nklein-tool-call-display": resolve(__dirname, "../src/nklein-agent/nklein-tool-call-display.ts"),
			"@runtime-home-agent-session": resolve(__dirname, "../src/core/home-agent-session.ts"),
			"@runtime-task-context-import": resolve(__dirname, "../src/core/task-context-import.ts"),
			"@runtime-shortcuts": resolve(__dirname, "../src/config/shortcut-utils.ts"),
			"@runtime-task-id": resolve(__dirname, "../src/core/task-id.ts"),
			"@runtime-task-title": resolve(__dirname, "../src/core/task-title.ts"),
			"@runtime-task-worktree-path": resolve(__dirname, "../src/workspace/task-worktree-path.ts"),
			"@runtime-task-state": resolve(__dirname, "../src/core/task-board-mutations.ts"),
			"@runtime-bulk-seed": resolve(__dirname, "../src/core/bulk-seed.ts"),
			"@runtime-operator-board-health": resolve(__dirname, "../src/core/operator-board-health.ts"),
			"@runtime-live-agent-state": resolve(__dirname, "../src/core/live-agent-state.ts"),
			"@runtime-agent-stuckness": resolve(__dirname, "../src/core/agent-stuckness.ts"),
			"@runtime-capability-ceiling": resolve(__dirname, "../src/core/capability-ceiling-recommendation.ts"),
			"@runtime-eval-freshness": resolve(__dirname, "../src/core/eval-freshness-decay.ts"),
			"@runtime-escalation-suggestions": resolve(__dirname, "../src/core/escalation-suggestions.ts"),
			"@runtime-escalation-resume-action": resolve(__dirname, "../src/core/escalation-resume-action.ts"),
			"@runtime-chat-execution-posture": resolve(__dirname, "../src/chat/chat-execution-posture.ts"),
		},
		conditions: ["import", "module", "browser", "default"],
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		passWithNoTests: true,
		setupFiles: ["./vitest.setup.ts"],
	},
});
