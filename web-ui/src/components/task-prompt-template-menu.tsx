import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ListChecks, ShieldCheck, Sparkles, TestTube2, Wrench } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

interface TaskPromptTemplate {
	id: string;
	label: string;
	icon: ReactElement;
	prompt: string;
}

const TASK_PROMPT_TEMPLATES: readonly TaskPromptTemplate[] = [
	{
		id: "bug-fix",
		label: "Bug fix",
		icon: <Wrench size={14} />,
		prompt: [
			"Fix the bug where ...",
			"",
			"Context:",
			"- Observed behavior:",
			"- Expected behavior:",
			"- Likely files:",
			"",
			"Acceptance:",
			"- Add or update a regression test.",
			"- Run the focused test command and report the result.",
		].join("\n"),
	},
	{
		id: "small-feature",
		label: "Small feature",
		icon: <Sparkles size={14} />,
		prompt: [
			"Implement ...",
			"",
			"Scope:",
			"- User-visible behavior:",
			"- Out of scope:",
			"- Likely files:",
			"",
			"Acceptance:",
			"- Add focused coverage for the new behavior.",
			"- Run typecheck and the focused tests.",
		].join("\n"),
	},
	{
		id: "test-coverage",
		label: "Test coverage",
		icon: <TestTube2 size={14} />,
		prompt: [
			"Add test coverage for ...",
			"",
			"Target behavior:",
			"-",
			"",
			"Acceptance:",
			"- The new test fails before the fix or documents the existing behavior.",
			"- The focused test target passes.",
		].join("\n"),
	},
	{
		id: "security-review",
		label: "Security review",
		icon: <ShieldCheck size={14} />,
		prompt: [
			"/nklein-security",
			"",
			"Review and harden ...",
			"",
			"Trust boundary:",
			"-",
			"",
			"Acceptance:",
			"- Keep deny-by-default behavior intact.",
			"- Add regression coverage for the blocked and allowed paths.",
		].join("\n"),
	},
	{
		id: "decompose",
		label: "Decompose",
		icon: <ListChecks size={14} />,
		prompt: [
			"/kanban-decompose",
			"",
			"Decompose this project into small Planning cards:",
			"",
			"Goal:",
			"-",
			"",
			"Constraints:",
			"- Keep leaves small enough for local models.",
			"- Include acceptance commands for each leaf.",
		].join("\n"),
	},
];

export function TaskPromptTemplateMenu({
	onSelectTemplate,
}: {
	onSelectTemplate: (prompt: string) => void;
}): ReactElement {
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<Button variant="ghost" size="sm" icon={<Sparkles size={14} />}>
					Templates
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 min-w-44 rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
				>
					{TASK_PROMPT_TEMPLATES.map((template) => (
						<DropdownMenu.Item
							key={template.id}
							className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
							onSelect={() => onSelectTemplate(template.prompt)}
						>
							<span className="text-text-secondary">{template.icon}</span>
							<span>{template.label}</span>
						</DropdownMenu.Item>
					))}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
