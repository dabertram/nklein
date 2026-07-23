import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { useId } from "react";

/**
 * F1.34b-ext (David 2026-07-23): the operator's upfront testability declaration for a card. Test-driven delivery
 * is on by default, so testable work must ship with a test change; this compact control is how an operator
 * declares — ahead of any work — that a card's work cannot be covered by automated tests (docs, assets,
 * config-only wiring) and may legitimately deliver without one. Unchecked = testable (the strict default).
 */
export function TaskTestabilityField({
	notTestable,
	onNotTestableChange,
	reason,
	onReasonChange,
	idPrefix,
}: {
	notTestable: boolean;
	onNotTestableChange: (notTestable: boolean) => void;
	reason: string;
	onReasonChange: (reason: string) => void;
	idPrefix?: string;
}) {
	const generatedId = useId();
	const checkboxId = `${idPrefix ?? generatedId}-not-testable`;
	return (
		<div className="flex items-center gap-2 flex-wrap">
			<label
				htmlFor={checkboxId}
				className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
				title="Test-driven delivery is on by default: testable work must include a test change. Check this only when automated tests cannot cover the work (docs, assets, config-only wiring)."
			>
				<RadixCheckbox.Root
					id={checkboxId}
					checked={notTestable}
					onCheckedChange={(checked) => onNotTestableChange(checked === true)}
					className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
				>
					<RadixCheckbox.Indicator>
						<Check size={10} className="text-white" />
					</RadixCheckbox.Indicator>
				</RadixCheckbox.Root>
				Not testable (no test required)
			</label>
			{notTestable ? (
				<input
					type="text"
					value={reason}
					onChange={(event) => onReasonChange(event.currentTarget.value)}
					placeholder="Why can't tests cover this?"
					className="min-w-0 flex-1 rounded-md border border-border bg-surface-3 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
					style={{ minWidth: "22ch" }}
				/>
			) : null}
		</div>
	);
}
