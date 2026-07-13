import {
	type ClarificationSelectionMode,
	DEFAULT_CLARIFICATION_OPTION_SET_CONFIG,
	prepareClarificationOptionSet,
} from "@runtime-clarification-option-set";
import { CircleHelp } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyError, showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { answerNKleinPlanQuestion, listNKleinPlanQuestions } from "@/runtime/queries/plan-artifacts";
import type { RuntimePlanQuestion } from "@/runtime/types";

/**
 * F1.4 — the clarification dialog for a plan's OPEN questions (§5.S manual mode): every question renders its
 * prepared option set (≥4 explained choices — recommended first, generic fall-backs synthesised when the agent
 * under-supplied — via `prepareClarificationOptionSet`, never re-derived here) plus a free-text field; submitting
 * goes through `answerNKleinPlanQuestion`, which persists the answer as a `clarification_resolved` plan revision
 * and resumes the exact card parked on the question, when any. Resolved questions stay visible in a collapsed
 * "answered" list (durable answer review). Renders nothing when the plan has no questions at all.
 */

/** "Select all that apply" wording flips the dialog to checkbox semantics; the default is single-select radio. */
function deriveSelectionMode(question: RuntimePlanQuestion): ClarificationSelectionMode {
	return /\b(select all|all that apply|choose (?:any|multiple)|multi-?select)\b/i.test(question.question)
		? "multiple"
		: "single";
}

function OpenQuestionForm({
	workspaceId,
	planSlug,
	question,
	onAnswered,
}: {
	workspaceId: string | null;
	planSlug: string;
	question: RuntimePlanQuestion;
	onAnswered: () => void;
}): React.ReactElement {
	const selectionMode = deriveSelectionMode(question);
	const optionSet = useMemo(
		() =>
			prepareClarificationOptionSet(
				{ ...question, options: [...question.options] },
				{ ...DEFAULT_CLARIFICATION_OPTION_SET_CONFIG, selectionMode },
			),
		[question, selectionMode],
	);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [freeText, setFreeText] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const groupId = `plan-question-${question.id}`;

	const toggleOption = useCallback(
		(optionId: string) => {
			setSelectedIds((current) => {
				if (optionSet.selectionMode === "single") {
					return current.includes(optionId) ? [] : [optionId];
				}
				return current.includes(optionId)
					? current.filter((candidate) => candidate !== optionId)
					: [...current, optionId];
			});
		},
		[optionSet.selectionMode],
	);

	const submit = useCallback(async () => {
		// Synthesised fall-back options have no stored counterpart — submit their LABEL as free text so the answer
		// stays meaningful in the plan revision ("Use your best judgement" instead of a dangling synthetic id).
		const suppliedIds = new Set(question.options.map((option) => option.id));
		const storedSelections = selectedIds.filter((id) => suppliedIds.has(id));
		const synthesisedLabels = optionSet.options
			.filter((option) => option.synthesised && selectedIds.includes(option.id))
			.map((option) => option.label);
		const combinedFreeText = [...synthesisedLabels, freeText.trim()].filter(Boolean).join("; ");
		if (storedSelections.length === 0 && combinedFreeText.length === 0) {
			notifyError("Pick an option or type an answer first.");
			return;
		}
		setIsSubmitting(true);
		try {
			const response = await answerNKleinPlanQuestion(workspaceId, {
				planSlug,
				questionId: question.id,
				selectedOptionIds: storedSelections,
				freeText: combinedFreeText || undefined,
			});
			if (!response.ok) {
				notifyError(response.error ?? "Could not record the answer.");
				return;
			}
			showAppToast({
				intent: "success",
				message: response.resumedTaskId
					? `Answer recorded — resumed the blocked card (${response.resumedTaskId}).`
					: "Answer recorded in the plan.",
				timeout: 5000,
			});
			if (response.error) {
				// ok:true + error = the answer is durable but the parked card could not be resumed automatically.
				notifyError(response.error);
			}
			onAnswered();
		} catch (error) {
			notifyError(error instanceof Error ? error.message : "Could not record the answer.");
		} finally {
			setIsSubmitting(false);
		}
	}, [freeText, onAnswered, optionSet.options, planSlug, question.id, question.options, selectedIds, workspaceId]);

	return (
		<fieldset className="rounded-md border border-border-default p-3" data-testid="plan-question-form">
			<legend className="px-1 text-sm font-medium">{optionSet.question}</legend>
			<div className="flex flex-col gap-2" role={optionSet.selectionMode === "single" ? "radiogroup" : "group"}>
				{optionSet.options.map((option) => (
					<label
						key={option.id}
						className="flex cursor-pointer items-start gap-2 text-sm"
						htmlFor={`${groupId}-${option.id}`}
					>
						<input
							id={`${groupId}-${option.id}`}
							type={optionSet.selectionMode === "single" ? "radio" : "checkbox"}
							name={groupId}
							checked={selectedIds.includes(option.id)}
							onChange={() => toggleOption(option.id)}
							className="mt-0.5"
						/>
						<span>
							<span className="font-medium">{option.label}</span>
							{option.recommended ? <span className="ml-1 text-xs text-status-green">(recommended)</span> : null}
							{option.description ? (
								<span className="block text-xs text-text-secondary">{option.description}</span>
							) : null}
						</span>
					</label>
				))}
			</div>
			{optionSet.allowFreeText ? (
				<div className="mt-2">
					<label className="text-xs text-text-secondary" htmlFor={`${groupId}-free-text`}>
						Or answer in your own words
					</label>
					<textarea
						id={`${groupId}-free-text`}
						value={freeText}
						onChange={(event) => setFreeText(event.target.value)}
						rows={2}
						className="mt-1 w-full rounded-md border border-border-default bg-surface-primary p-2 text-sm"
						placeholder="Type an answer…"
					/>
				</div>
			) : null}
			<div className="mt-2 flex justify-end">
				<Button size="sm" onClick={() => void submit()} disabled={isSubmitting} data-testid="plan-question-submit">
					{isSubmitting ? <Spinner size={12} /> : null}
					Answer
				</Button>
			</div>
		</fieldset>
	);
}

export function PlanQuestionsPanel({
	workspaceId,
	planSlug,
	onAnswered,
}: {
	workspaceId: string | null;
	planSlug: string;
	onAnswered?: (resumedTaskId: string | null) => void;
}): React.ReactElement | null {
	const [questions, setQuestions] = useState<RuntimePlanQuestion[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [showResolved, setShowResolved] = useState(false);
	const [reloadNonce, setReloadNonce] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		void listNKleinPlanQuestions(workspaceId, { planSlug, openOnly: false })
			.then((response) => {
				if (!cancelled && response.ok) {
					setQuestions(response.questions);
				}
			})
			.catch(() => {
				// A plan without artifacts simply has no questions to show.
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [planSlug, reloadNonce, workspaceId]);

	const open = questions.filter((question) => question.status === "open");
	const resolved = questions.filter((question) => question.status !== "open");
	if (!isLoading && questions.length === 0) {
		return null;
	}
	return (
		<section className="flex flex-col gap-2" aria-label="Plan clarification questions">
			<div className="flex items-center gap-2 text-sm font-medium">
				<CircleHelp size={14} />
				Plan questions
				{isLoading ? <Spinner size={12} /> : null}
			</div>
			{open.map((question) => (
				<OpenQuestionForm
					key={question.id}
					workspaceId={workspaceId}
					planSlug={planSlug}
					question={question}
					onAnswered={() => {
						setReloadNonce((nonce) => nonce + 1);
						onAnswered?.(null);
					}}
				/>
			))}
			{resolved.length > 0 ? (
				<div>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setShowResolved((current) => !current)}
						aria-expanded={showResolved}
						data-testid="plan-questions-resolved-toggle"
					>
						{showResolved ? "Hide" : "Show"} {resolved.length} answered question{resolved.length === 1 ? "" : "s"}
					</Button>
					{showResolved ? (
						<ul
							className="mt-1 flex flex-col gap-1 text-xs text-text-secondary"
							data-testid="plan-questions-resolved"
						>
							{resolved.map((question) => (
								<li key={question.id}>
									<span className="font-medium">{question.question}</span>{" "}
									{question.status === "answered"
										? `— answered: ${question.answer ?? ""}`
										: `— assumed default: ${question.assumption ?? ""}`}
								</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
		</section>
	);
}
