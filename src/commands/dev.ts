import type { Command } from "commander";
import { runClineDevSmokeEval } from "../cline-sdk/cline-eval-harness";

interface DevSmokeEvalOptions {
	json?: boolean;
	parentDir?: string;
	evidenceRoot?: string;
	git?: boolean;
	write?: (text: string) => void;
}

export async function runDevSmokeEvalCommand(options: DevSmokeEvalOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const result = await runClineDevSmokeEval({
		parentDir: options.parentDir,
		evidenceRootDir: options.evidenceRoot,
		initializeGit: options.git !== false,
	});
	if (options.json) {
		write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	write(`${result.passed ? "Dev smoke eval passed." : "Dev smoke eval failed."}\n`);
	write(`Workspace: ${result.workspacePath}\n`);
	write(`Evidence: ${result.evidenceBundlePath}\n`);
	write(`Command: ${result.acceptanceCommand}\n`);
	if (!result.passed && result.output.trim()) {
		write(`${result.output.trim()}\n`);
	}
}

export function registerDevCommand(program: Command): void {
	const dev = program.command("dev").description("Developer-only Kanban diagnostics and smoke tests.");

	dev.command("smoke-eval")
		.description("Run the bundled dev smoke eval and write an evidence bundle.")
		.option("--json", "Print machine-readable JSON.")
		.option("--parent-dir <path>", "Parent directory for the throwaway workspace.")
		.option("--evidence-root <path>", "Directory for evidence bundles.")
		.option("--no-git", "Skip git initialization in the throwaway workspace.")
		.action(async (options: DevSmokeEvalOptions) => {
			await runDevSmokeEvalCommand(options);
		});
}
