import type {
	AppendNKleinPlanRevisionInput,
	NKleinPlanQuestion,
	NKleinPlanQuestionOption,
} from "./nklein-plan-artifacts";

/**
 * Pure markdown renderers for NKlein plan artifacts (questions / decisions / revisions), extracted
 * from nklein-plan-artifacts. No I/O — they build the artifact file bodies from data, so they are
 * behavior-preserving. The data types are type-only imports from the owner module (erased at build,
 * so there is no runtime cycle).
 */

/** Render the `questions.md` body: each question's status, prompt, options, and any answer/assumption. */
export function formatQuestionsMarkdown(questions: readonly NKleinPlanQuestion[]): string {
	if (questions.length === 0) {
		return "# Questions\n\nNo clarifying questions were recorded.\n";
	}
	const sections = ["# Questions"];
	for (const question of questions) {
		const lines = [`## ${question.id}`, "", `Status: ${question.status}`, "", question.question.trim()];
		if (question.options.length > 0) {
			lines.push("", "Options:");
			for (const option of question.options) {
				const recommended = option.recommended ? " (recommended)" : "";
				const description = option.description?.trim() ? ` - ${option.description.trim()}` : "";
				lines.push(`- ${option.id}: ${option.label}${recommended}${description}`);
			}
		}
		if (question.answer?.trim()) {
			lines.push("", `Answer: ${question.answer.trim()}`);
		}
		if (question.assumption?.trim()) {
			lines.push("", `Assumption: ${question.assumption.trim()}`);
		}
		if (question.blockedTaskId?.trim()) {
			lines.push("", `Blocked task: ${question.blockedTaskId.trim()}`);
		}
		sections.push(lines.join("\n"));
	}
	return `${sections.join("\n\n")}\n`;
}

/** Render the initial `decisions.md` body from the questions that already carry an answer or assumption. */
export function formatInitialDecisionsMarkdown(questions: readonly NKleinPlanQuestion[]): string {
	const decisions = questions.filter((question) => question.answer?.trim() || question.assumption?.trim());
	if (decisions.length === 0) {
		return "# Decisions\n\nNo shared decisions have been recorded yet.\n";
	}
	const sections = ["# Decisions"];
	for (const question of decisions) {
		const lines = [`## ${question.id}`, "", question.question.trim()];
		if (question.answer?.trim()) {
			lines.push("", `Decision: ${question.answer.trim()}`);
		}
		if (question.assumption?.trim()) {
			lines.push("", `Assumption: ${question.assumption.trim()}`);
		}
		if (question.blockedTaskId?.trim()) {
			lines.push("", `Blocked task: ${question.blockedTaskId.trim()}`);
		}
		sections.push(lines.join("\n"));
	}
	return `${sections.join("\n\n")}\n`;
}

/** The empty `revisions.md` body for a freshly created plan. */
export function formatInitialRevisionsMarkdown(): string {
	return "# Revisions\n\nNo plan revisions have been recorded yet.\n";
}

function formatRevisionTimestamp(timestamp: number): string {
	return new Date(timestamp).toISOString();
}

/** Render one appended revision entry: an ISO-timestamped heading plus optional task id, description, and evidence. */
export function formatRevisionEntry(input: AppendNKleinPlanRevisionInput): string {
	const lines = [
		`## ${formatRevisionTimestamp(input.createdAt ?? Date.now())} - ${input.kind.trim() || "plan_gap"}`,
		"",
	];
	if (input.taskId?.trim()) {
		lines.push(`Task: ${input.taskId.trim()}`, "");
	}
	lines.push(input.description.trim() || "Plan revision recorded.");
	if (input.evidence?.trim()) {
		lines.push("", `Evidence: ${input.evidence.trim()}`);
	}
	return `${lines.join("\n")}\n`;
}

/**
 * F1.3a — parse a `questions.md` body (as rendered by {@link formatQuestionsMarkdown}) back into structured
 * questions. Inverse of the renderer for machine-written files; tolerant of hand edits: unknown statuses fall back
 * to `open`, malformed option lines are kept as label-only options, and a body without `## ` sections yields `[]`.
 */
export function parseQuestionsMarkdown(markdown: string): NKleinPlanQuestion[] {
	const questions: NKleinPlanQuestion[] = [];
	const sections = markdown.split(/^## /m).slice(1); // drop everything before the first question heading
	for (const section of sections) {
		const lines = section.split("\n");
		const id = (lines[0] ?? "").trim();
		if (!id) {
			continue;
		}
		let status: NKleinPlanQuestion["status"] = "open";
		let answer: string | null = null;
		let assumption: string | null = null;
		let blockedTaskId: string | null = null;
		const options: NKleinPlanQuestionOption[] = [];
		const questionLines: string[] = [];
		let inOptions = false;
		for (const rawLine of lines.slice(1)) {
			const line = rawLine.trimEnd();
			const statusMatch = /^Status:\s*(.+)$/.exec(line);
			if (statusMatch?.[1]) {
				const candidate = statusMatch[1].trim();
				if (candidate === "open" || candidate === "answered" || candidate === "assumed-default") {
					status = candidate;
				}
				continue;
			}
			const answerMatch = /^Answer:\s*(.*)$/.exec(line);
			if (answerMatch) {
				answer = answerMatch[1]?.trim() || null;
				inOptions = false;
				continue;
			}
			const assumptionMatch = /^Assumption:\s*(.*)$/.exec(line);
			if (assumptionMatch) {
				assumption = assumptionMatch[1]?.trim() || null;
				inOptions = false;
				continue;
			}
			const blockedMatch = /^Blocked task:\s*(.*)$/.exec(line);
			if (blockedMatch) {
				blockedTaskId = blockedMatch[1]?.trim() || null;
				inOptions = false;
				continue;
			}
			if (/^Options:\s*$/.test(line)) {
				inOptions = true;
				continue;
			}
			if (inOptions && line.startsWith("- ")) {
				options.push(parseQuestionOptionLine(line.slice(2)));
				continue;
			}
			if (inOptions && line.trim() === "") {
				continue; // blank inside/after the options block — stay tolerant, a labeled line ends it anyway
			}
			inOptions = false;
			questionLines.push(line);
		}
		const question = questionLines.join("\n").trim();
		if (!question) {
			continue;
		}
		questions.push({ id, question, status, options, answer, assumption, blockedTaskId });
	}
	return questions;
}

/** Parse one rendered option line (`<id>: <label>( (recommended))?( - <description>)?`), tolerantly. */
function parseQuestionOptionLine(content: string): NKleinPlanQuestionOption {
	const separator = content.indexOf(": ");
	const id = separator > 0 ? content.slice(0, separator).trim() : content.trim();
	let rest = separator > 0 ? content.slice(separator + 2) : "";
	let description: string | null = null;
	const descriptionSeparator = rest.indexOf(" - ");
	if (descriptionSeparator >= 0) {
		description = rest.slice(descriptionSeparator + 3).trim() || null;
		rest = rest.slice(0, descriptionSeparator);
	}
	let recommended = false;
	if (rest.endsWith(" (recommended)")) {
		recommended = true;
		rest = rest.slice(0, -" (recommended)".length);
	}
	const label = rest.trim() || id;
	return { id: id || label, label, description, recommended };
}
