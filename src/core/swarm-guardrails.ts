import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { lockedFileSystem } from "../fs/locked-file-system";

const SWARM_STOP_FILENAME = "swarm-stop.json";

export const swarmStopSignalSchema = z.object({
	stopped: z.literal(true),
	reason: z.string(),
	createdAt: z.number(),
});
export type SwarmStopSignal = z.infer<typeof swarmStopSignalSchema>;

export function getSwarmStopSignalPath(workspacePath: string): string {
	return join(workspacePath, ".cline", "kanban", SWARM_STOP_FILENAME);
}

export async function readSwarmStopSignal(workspacePath: string): Promise<SwarmStopSignal | null> {
	const path = getSwarmStopSignalPath(workspacePath);
	try {
		return swarmStopSignalSchema.parse(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return null;
	}
}

export async function requestSwarmStop(input: {
	workspacePath: string;
	reason?: string | null;
	now?: number;
}): Promise<SwarmStopSignal> {
	const path = getSwarmStopSignalPath(input.workspacePath);
	const signal: SwarmStopSignal = {
		stopped: true,
		reason: input.reason?.trim() || "Operator stop signal is active.",
		createdAt: input.now ?? Date.now(),
	};
	await mkdir(join(input.workspacePath, ".cline", "kanban"), { recursive: true });
	await lockedFileSystem.writeJsonFileAtomic(path, signal, { lock: null });
	return signal;
}

export async function clearSwarmStop(workspacePath: string): Promise<void> {
	await rm(getSwarmStopSignalPath(workspacePath), { force: true });
}
