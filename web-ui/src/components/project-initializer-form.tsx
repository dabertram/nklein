import {
	assessProjectInitializerBrief,
	buildInitialDecompositionPreview,
	type ProjectInitializerBriefInput,
	renderProjectEarsCriteria,
} from "@runtime-project-initializer";
import { ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

export const EMPTY_PROJECT_INITIALIZER_BRIEF: ProjectInitializerBriefInput = {
	mode: "beginner",
	projectKind: "greenfield",
	outcome: "",
	audience: "",
	stackRuntime: "",
	acceptanceCommands: "",
	successCriteria: "",
	inScope: "",
	outOfScope: "",
	domainConcepts: "",
	constraints: "",
	uncertainties: "",
	effort: "medium",
	autonomy: "checkpoints",
	batchBrief: "",
	references: [],
};

const BEGINNER_STEPS = ["Vision", "Technical", "Boundaries", "Done", "References", "Preview"] as const;

function TextAreaField({
	id,
	label,
	value,
	onChange,
	placeholder,
	disabled,
	rows = 3,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	disabled: boolean;
	rows?: number;
}): ReactElement {
	return (
		<label htmlFor={id} className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
			{label}
			<textarea
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				rows={rows}
				disabled={disabled}
				className="w-full resize-y rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none disabled:opacity-60"
			/>
		</label>
	);
}

function splitReferenceLines(value: string): ProjectInitializerBriefInput["references"] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 19)
		.map((line) => ({ kind: /^https?:\/\//iu.test(line) ? "url" : "file", value: line }));
}

export function ProjectInitializerForm({
	value,
	onChange,
	disabled,
}: {
	value: ProjectInitializerBriefInput;
	onChange: (value: ProjectInitializerBriefInput) => void;
	disabled: boolean;
}): ReactElement {
	const [beginnerStep, setBeginnerStep] = useState(0);
	const readiness = useMemo(() => assessProjectInitializerBrief(value), [value]);
	const preview = useMemo(() => buildInitialDecompositionPreview(value), [value]);
	const earsCriteria = useMemo(() => renderProjectEarsCriteria(value.successCriteria), [value.successCriteria]);
	const pastedReference = value.references.find((reference) => reference.kind === "pasted")?.value ?? "";
	const linkedReferences = value.references
		.filter((reference) => reference.kind !== "pasted")
		.map((reference) => reference.value)
		.join("\n");
	const patch = <K extends keyof ProjectInitializerBriefInput>(key: K, next: ProjectInitializerBriefInput[K]) => {
		onChange({ ...value, [key]: next });
	};
	const updateReferences = (pasted: string, linked: string) => {
		patch("references", [
			...(pasted.trim() ? [{ kind: "pasted" as const, value: pasted, label: "Pasted project reference" }] : []),
			...splitReferenceLines(linked),
		]);
	};

	const referenceFields = (
		<div className="grid gap-3 md:grid-cols-2">
			<TextAreaField
				id="project-init-pasted-reference"
				label="Pasted PRD, draft, design notes, or issue text"
				value={pastedReference}
				onChange={(next) => updateReferences(next, linkedReferences)}
				placeholder="Paste source material. It is screened and fenced as untrusted data."
				disabled={disabled}
				rows={5}
			/>
			<TextAreaField
				id="project-init-linked-references"
				label="Reference URLs or server file paths — one per line"
				value={linkedReferences}
				onChange={(next) => updateReferences(pastedReference, next)}
				placeholder={"https://…/issue/123\n/path/to/spec.md"}
				disabled={disabled}
				rows={5}
			/>
		</div>
	);

	const executionPosture = (
		<div className="grid gap-3 md:grid-cols-2">
			<label className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
				Rough effort
				<select
					value={value.effort}
					onChange={(event) => patch("effort", event.target.value as ProjectInitializerBriefInput["effort"])}
					disabled={disabled}
					className="h-8 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary"
				>
					<option value="small">Small</option>
					<option value="medium">Medium</option>
					<option value="large">Large</option>
				</select>
			</label>
			<label className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
				Operator checkpoints
				<select
					value={value.autonomy}
					onChange={(event) => patch("autonomy", event.target.value as ProjectInitializerBriefInput["autonomy"])}
					disabled={disabled}
					className="h-8 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary"
				>
					<option value="autonomous">Autonomous within the brief</option>
					<option value="checkpoints">Checkpoint at risky decisions</option>
					<option value="collaborative">Frequent collaboration</option>
				</select>
			</label>
		</div>
	);

	let beginnerContent: ReactElement;
	switch (beginnerStep) {
		case 0:
			beginnerContent = (
				<div className="grid gap-3 md:grid-cols-2">
					<TextAreaField
						id="project-init-outcome"
						label="What does done look like?"
						value={value.outcome}
						onChange={(next) => patch("outcome", next)}
						placeholder="The concrete outcome this project must deliver."
						disabled={disabled}
					/>
					<TextAreaField
						id="project-init-audience"
						label="Who is it for?"
						value={value.audience}
						onChange={(next) => patch("audience", next)}
						placeholder="Users, operators, or stakeholders and their need."
						disabled={disabled}
					/>
				</div>
			);
			break;
		case 1:
			beginnerContent = (
				<div className="grid gap-3 md:grid-cols-2">
					<TextAreaField
						id="project-init-stack"
						label="Stack / runtime"
						value={value.stackRuntime}
						onChange={(next) => patch("stackRuntime", next)}
						placeholder="Language, framework, package manager, target platform, versions."
						disabled={disabled}
					/>
					<TextAreaField
						id="project-init-domain"
						label="Domain concepts and rules"
						value={value.domainConcepts}
						onChange={(next) => patch("domainConcepts", next)}
						placeholder="Define nouns, states, invariants, and rules a small model must not infer."
						disabled={disabled}
					/>
				</div>
			);
			break;
		case 2:
			beginnerContent = (
				<div className="grid gap-3 md:grid-cols-3">
					<TextAreaField
						id="project-init-in-scope"
						label="In scope"
						value={value.inScope}
						onChange={(next) => patch("inScope", next)}
						placeholder="Included behavior and deliverables."
						disabled={disabled}
					/>
					<TextAreaField
						id="project-init-out-scope"
						label="Out of scope"
						value={value.outOfScope}
						onChange={(next) => patch("outOfScope", next)}
						placeholder="Explicit exclusions that stop decomposition sprawl."
						disabled={disabled}
					/>
					<TextAreaField
						id="project-init-constraints"
						label="Constraints / do not"
						value={value.constraints}
						onChange={(next) => patch("constraints", next)}
						placeholder="Performance, dependency, style, security limits; prohibited approaches."
						disabled={disabled}
					/>
				</div>
			);
			break;
		case 3:
			beginnerContent = (
				<div className="grid gap-3 md:grid-cols-2">
					<TextAreaField
						id="project-init-commands"
						label="Commands that must pass"
						value={value.acceptanceCommands}
						onChange={(next) => patch("acceptanceCommands", next)}
						placeholder="npm test, build/lint commands, or another exact check."
						disabled={disabled}
					/>
					<TextAreaField
						id="project-init-success"
						label="Observable success criteria"
						value={value.successCriteria}
						onChange={(next) => patch("successCriteria", next)}
						placeholder="One required system behavior per line, e.g. ‘allow a household to export a plan’; !Klein emits canonical EARS."
						disabled={disabled}
					/>
					<EarsCriteriaPreview criteria={earsCriteria} />
				</div>
			);
			break;
		case 4:
			beginnerContent = (
				<div className="flex flex-col gap-3">
					{referenceFields}
					<TextAreaField
						id="project-init-uncertainty"
						label="Risks / uncertainty"
						value={value.uncertainties}
						onChange={(next) => patch("uncertainties", next)}
						placeholder="What is undecided or risky? Write ‘none known’ if there are none."
						disabled={disabled}
						rows={2}
					/>
					{executionPosture}
				</div>
			);
			break;
		default:
			beginnerContent = (
				<section className="flex flex-col gap-3" aria-label="Initial decomposition preview">
					<p className="text-[12px] text-text-secondary">
						Pre-model planning tracks. The seeded architect card refines these before any implementation starts.
					</p>
					{preview.map((track, index) => (
						<div key={track.title} className="rounded-md border border-border bg-surface-2 px-3 py-2">
							<p className="text-[13px] font-medium text-text-primary">
								{index + 1}. {track.title}
							</p>
							<p className="text-[12px] text-text-secondary">{track.purpose}</p>
						</div>
					))}
					<ReadinessSummary readiness={readiness} />
					<EarsCriteriaPreview criteria={earsCriteria} />
				</section>
			);
	}

	return (
		<section className="rounded-md border border-border bg-surface-1 p-3" aria-label="Guided project brief">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<p className="text-[13px] font-semibold text-text-primary">Canonical project brief</p>
					<p className="text-[11px] text-text-tertiary">
						Saved as PROJECT_BRIEF.md and used by the seeded architect card.
					</p>
				</div>
				<div className="rounded-md bg-surface-2 p-1">
					{(["beginner", "pro"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							onClick={() => patch("mode", mode)}
							disabled={disabled}
							className={cn(
								"rounded px-2 py-1 text-[11px] capitalize",
								value.mode === mode ? "bg-surface-4 text-text-primary" : "text-text-secondary",
							)}
						>
							{mode}
						</button>
					))}
				</div>
			</div>
			{value.mode === "beginner" ? (
				<>
					<nav className="mb-3 grid grid-cols-6 gap-1" aria-label="Initializer steps">
						{BEGINNER_STEPS.map((step, index) => (
							<button
								key={step}
								type="button"
								onClick={() => setBeginnerStep(index)}
								className={cn(
									"rounded px-1 py-1 text-[10px]",
									index === beginnerStep ? "bg-accent/20 text-accent" : "bg-surface-2 text-text-tertiary",
								)}
							>
								{step}
							</button>
						))}
					</nav>
					{beginnerContent}
					<div className="mt-3 flex justify-between">
						<Button
							type="button"
							variant="default"
							size="sm"
							disabled={beginnerStep === 0 || disabled}
							onClick={() => setBeginnerStep((step) => Math.max(0, step - 1))}
						>
							<ChevronLeft size={12} /> Back
						</Button>
						<Button
							type="button"
							variant="default"
							size="sm"
							disabled={beginnerStep === BEGINNER_STEPS.length - 1 || disabled}
							onClick={() => setBeginnerStep((step) => Math.min(BEGINNER_STEPS.length - 1, step + 1))}
						>
							Next <ChevronRight size={12} />
						</Button>
					</div>
				</>
			) : (
				<div className="flex flex-col gap-3">
					<TextAreaField
						id="project-init-batch"
						label="Paste the whole brief at once"
						value={value.batchBrief ?? ""}
						onChange={(next) => patch("batchBrief", next)}
						placeholder="Paste a complete PRD/spec. The canonical preview preserves explicit gaps instead of guessing missing categories."
						disabled={disabled}
						rows={9}
					/>
					<div className="grid gap-3 md:grid-cols-3">
						<TextAreaField
							id="project-init-pro-commands"
							label="Acceptance command / check"
							value={value.acceptanceCommands}
							onChange={(next) => patch("acceptanceCommands", next)}
							placeholder="Exact command or observable check."
							disabled={disabled}
							rows={2}
						/>
						<TextAreaField
							id="project-init-pro-success"
							label="Observable success criteria"
							value={value.successCriteria}
							onChange={(next) => patch("successCriteria", next)}
							placeholder="One system behavior per line, e.g. ‘allow a user to export a plan’."
							disabled={disabled}
							rows={2}
						/>
						<TextAreaField
							id="project-init-pro-outcome"
							label="Outcome override (optional when supplied brief is complete)"
							value={value.outcome}
							onChange={(next) => patch("outcome", next)}
							placeholder="Concise north star."
							disabled={disabled}
							rows={2}
						/>
					</div>
					<EarsCriteriaPreview criteria={earsCriteria} />
					{referenceFields}
					{executionPosture}
					<details className="rounded-md border border-border bg-surface-2 p-2">
						<summary className="cursor-pointer text-[12px] text-text-secondary">
							Structured overrides / confirmations
						</summary>
						<div className="mt-3 grid gap-3 md:grid-cols-2">
							<TextAreaField
								id="project-init-pro-audience"
								label="Audience"
								value={value.audience}
								onChange={(next) => patch("audience", next)}
								placeholder="Who it is for."
								disabled={disabled}
								rows={2}
							/>
							<TextAreaField
								id="project-init-pro-stack"
								label="Stack / runtime"
								value={value.stackRuntime}
								onChange={(next) => patch("stackRuntime", next)}
								placeholder="Versions and platform."
								disabled={disabled}
								rows={2}
							/>
							<TextAreaField
								id="project-init-pro-domain"
								label="Domain concepts"
								value={value.domainConcepts}
								onChange={(next) => patch("domainConcepts", next)}
								placeholder="Nouns and rules."
								disabled={disabled}
								rows={2}
							/>
							<TextAreaField
								id="project-init-pro-in"
								label="In scope"
								value={value.inScope}
								onChange={(next) => patch("inScope", next)}
								placeholder="Included."
								disabled={disabled}
								rows={2}
							/>
							<TextAreaField
								id="project-init-pro-out"
								label="Out of scope"
								value={value.outOfScope}
								onChange={(next) => patch("outOfScope", next)}
								placeholder="Excluded."
								disabled={disabled}
								rows={2}
							/>
							<TextAreaField
								id="project-init-pro-constraints"
								label="Constraints / do not"
								value={value.constraints}
								onChange={(next) => patch("constraints", next)}
								placeholder="Limits."
								disabled={disabled}
								rows={2}
							/>
							<TextAreaField
								id="project-init-pro-risks"
								label="Risks / uncertainty"
								value={value.uncertainties}
								onChange={(next) => patch("uncertainties", next)}
								placeholder="Open decisions."
								disabled={disabled}
								rows={2}
							/>
						</div>
					</details>
					<ReadinessSummary readiness={readiness} />
					<section aria-label="Initial decomposition preview" className="grid gap-2 md:grid-cols-2">
						{preview.map((track) => (
							<div key={track.title} className="rounded border border-border bg-surface-2 px-2 py-1.5">
								<p className="text-[12px] font-medium text-text-primary">{track.title}</p>
								<p className="text-[11px] text-text-secondary">{track.purpose}</p>
							</div>
						))}
					</section>
				</div>
			)}
		</section>
	);
}

function ReadinessSummary({
	readiness,
}: {
	readiness: ReturnType<typeof assessProjectInitializerBrief>;
}): ReactElement {
	return (
		<div
			className={cn(
				"rounded-md border px-3 py-2",
				readiness.ready ? "border-status-green/30 bg-status-green/5" : "border-status-orange/30 bg-status-orange/5",
			)}
		>
			<p className="flex items-center gap-1 text-[12px] font-medium text-text-primary">
				{!readiness.ready ? <ShieldAlert size={13} /> : null}
				{readiness.ready ? "Ready to create and seed planning" : "Brief needs answers before creation"}
			</p>
			{readiness.nextClarification ? (
				<p className="mt-1 text-[11px] text-text-secondary">
					Next clarification ({readiness.remainingWhatWhyClarifications} remaining):{" "}
					{readiness.nextClarification.question}
				</p>
			) : null}
			{readiness.clarifications.length > 0 ? (
				<p className="mt-1 text-[11px] text-text-tertiary">
					{readiness.clarifications.length} structured field(s) remain explicit OPEN items in the brief.
				</p>
			) : null}
			{readiness.quarantinedReferenceCount > 0 ? (
				<p className="mt-1 text-[11px] text-status-red">
					{readiness.quarantinedReferenceCount} pasted reference(s) will be quarantined.
				</p>
			) : null}
		</div>
	);
}

function EarsCriteriaPreview({ criteria }: { criteria: ReturnType<typeof renderProjectEarsCriteria> }): ReactElement {
	return (
		<section
			className="rounded-md border border-border bg-surface-2 px-3 py-2 md:col-span-2"
			aria-label="EARS criteria preview"
		>
			<p className="text-[12px] font-medium text-text-primary">Generated EARS criteria</p>
			{criteria.length > 0 ? (
				<ol className="mt-1 list-decimal pl-4 text-[11px] text-text-secondary">
					{criteria.map((criterion, index) => (
						<li key={`${index}:${criterion.text}`}>{criterion.text}</li>
					))}
				</ol>
			) : (
				<p className="mt-1 text-[11px] text-text-tertiary">Add observable success behavior to generate EARS.</p>
			)}
		</section>
	);
}
