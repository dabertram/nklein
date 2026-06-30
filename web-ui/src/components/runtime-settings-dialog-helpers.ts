// Pure helpers extracted from runtime-settings-dialog.tsx (§5.U — the dialog is the codebase's largest file).
// Keeping these out of the 3.9k-line component makes the label-collision + template-comparison rules unit-testable.
import type { RuntimeProjectShortcut } from "@/runtime/types";

/** Normalize a prompt-template string for equality comparison: CRLF -> LF and trim surrounding whitespace. */
export function normalizeTemplateForComparison(value: string): string {
	return value.replaceAll("\r\n", "\n").trim();
}

/**
 * The next unique shortcut label given the existing shortcuts: `baseLabel` when free, else `baseLabel 2`,
 * `baseLabel 3`, … (comparison is case-insensitive and ignores surrounding whitespace; blank labels are not "taken").
 */
export function getNextShortcutLabel(shortcuts: RuntimeProjectShortcut[], baseLabel: string): string {
	const normalizedTakenLabels = new Set(
		shortcuts.map((shortcut) => shortcut.label.trim().toLowerCase()).filter((label) => label.length > 0),
	);
	const normalizedBaseLabel = baseLabel.trim().toLowerCase();
	if (!normalizedTakenLabels.has(normalizedBaseLabel)) {
		return baseLabel;
	}

	let suffix = 2;
	while (normalizedTakenLabels.has(`${normalizedBaseLabel} ${suffix}`)) {
		suffix += 1;
	}
	return `${baseLabel} ${suffix}`;
}
