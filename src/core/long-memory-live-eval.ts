import { extractJsonFromModelText } from "./eval-answer-extraction.js";
import type { LongMemoryEvalCase, LongMemoryEvalPrompt } from "./long-memory-eval.js";

/**
 * Pure parser/scorer for the effectful LongMemEval live verifier. The model call stays in scripts; this module owns only
 * deterministic interpretation of the model's JSON selection/answer so the live validation is repeatable.
 */

export interface LongMemoryModelAnswer {
	answerable: boolean;
	answer: string;
}

export interface LongMemoryAnswerScore {
	passed: boolean;
	answerableExpected: boolean;
	parsed: LongMemoryModelAnswer | null;
	missingNeedles: readonly string[];
	reason: string;
}

export function parseLongMemorySelection(raw: string, validMemoryIds: readonly string[]): string[] {
	const parsed = extractJsonFromModelText(raw);
	const values = selectionValues(parsed);
	if (!values) {
		return [];
	}
	const valid = new Set(validMemoryIds);
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const value of values) {
		if (!valid.has(value) || seen.has(value)) {
			continue;
		}
		seen.add(value);
		ids.push(value);
	}
	return ids;
}

export function parseLongMemoryAnswer(raw: string): LongMemoryModelAnswer | null {
	const parsed = extractJsonFromModelText(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const record = parsed as Record<string, unknown>;
	const answerable = booleanField(record.answerable ?? record.hasAnswer ?? record.found);
	if (answerable === null) {
		return null;
	}
	const answer = record.answer;
	return {
		answerable,
		answer: typeof answer === "string" ? answer.trim() : "",
	};
}

export function scoreLongMemoryModelAnswer(
	case_: LongMemoryEvalCase,
	prompt: LongMemoryEvalPrompt,
	rawAnswer: string,
): LongMemoryAnswerScore {
	const parsed = parseLongMemoryAnswer(rawAnswer);
	const answerableExpected = prompt.relevantMemoryIds.length > 0;
	if (!parsed) {
		return {
			passed: false,
			answerableExpected,
			parsed: null,
			missingNeedles: [],
			reason: "answer JSON was not parseable",
		};
	}
	if (!answerableExpected) {
		return {
			passed: !parsed.answerable,
			answerableExpected,
			parsed,
			missingNeedles: [],
			reason: parsed.answerable ? "model claimed an answer for an unanswerable prompt" : "model abstained",
		};
	}
	if (!parsed.answerable) {
		return {
			passed: false,
			answerableExpected,
			parsed,
			missingNeedles: expectedNeedles(case_, prompt),
			reason: "model abstained on an answerable prompt",
		};
	}
	const normalizedAnswer = normalizeNeedle(parsed.answer);
	const missingNeedles = expectedNeedles(case_, prompt).filter(
		(needle) => !normalizedAnswer.includes(normalizeNeedle(needle)),
	);
	return {
		passed: missingNeedles.length === 0,
		answerableExpected,
		parsed,
		missingNeedles,
		reason: missingNeedles.length === 0 ? "answer included all expected evidence" : "answer missed expected evidence",
	};
}

function selectionValues(parsed: unknown): string[] | null {
	if (Array.isArray(parsed)) {
		return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
	}
	if (!parsed || typeof parsed !== "object") {
		return null;
	}
	const record = parsed as Record<string, unknown>;
	for (const key of ["memoryIds", "ids", "relevantMemoryIds", "selectedMemoryIds"]) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
		}
	}
	return null;
}

function booleanField(value: unknown): boolean | null {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true" || normalized === "yes") {
			return true;
		}
		if (normalized === "false" || normalized === "no") {
			return false;
		}
	}
	return null;
}

function expectedNeedles(case_: LongMemoryEvalCase, prompt: LongMemoryEvalPrompt): string[] {
	if (prompt.expectedAnswerMustInclude && prompt.expectedAnswerMustInclude.length > 0) {
		return [...prompt.expectedAnswerMustInclude];
	}
	return prompt.relevantMemoryIds
		.map((id) => case_.memories.find((memory) => memory.id === id)?.text ?? "")
		.filter((text) => text.length > 0);
}

function normalizeNeedle(value: string): string {
	return value.toLowerCase().replace(/\s+/gu, " ").trim();
}
