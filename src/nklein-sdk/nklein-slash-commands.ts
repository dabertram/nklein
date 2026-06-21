export interface NKleinBuiltinSlashCommandDefinition {
	name: string;
	description: string;
}

export const NKLEIN_BUILTIN_SLASH_COMMANDS: readonly NKleinBuiltinSlashCommandDefinition[] = [
	{
		name: "clear",
		description: "Start a fresh chat session and clear prior context.",
	},
];

function readLeadingSlashCommandName(text: string): string | null {
	const match = text.trim().match(/^\/([^\s]+)\s*$/);
	return match?.[1]?.toLowerCase() ?? null;
}

export function isNKleinClearSlashCommand(text: string): boolean {
	return readLeadingSlashCommandName(text) === "clear";
}
