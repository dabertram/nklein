/**
 * F2.36 (a) — the done.md → work-package split for the self board. PURE core.
 *
 * The sync mirrored every `## ` section of done.md into ONE completed card, so the 126-item "Phase 0" section and
 * the 64-item "SHIPPED" archive were single blobs on the DAG. Those sections already carry their real milestones as
 * `### ` sub-headers (5.A strict isolation, 5.K second-opinion review, 5.Y security hardening, …); this parser makes
 * each sub-section its own package, chained in document order after the items that precede the first sub-header,
 * so the spine reads as the milestones the archive already names. Sections without sub-headers are one package, as
 * before. Ids stay stable and derivable from the headings (`done:<section>` / `done:<section>--<sub>`), so existing
 * cards keep their identity and a re-sync never duplicates.
 */

export interface DonePackage {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
	/** Shipped `- [x]` items in this package (the prompt is built from them). */
	readonly itemCount: number;
}

export function slugifyDoneHeading(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 80);
}

interface OpenPackage {
	sectionTitle: string;
	subTitle: string | null;
	lines: string[];
}

function finish(open: OpenPackage, clampPrompt: (text: string) => string): DonePackage | null {
	const items = open.lines.filter((line) => /^- \[x\]/u.test(line));
	if (items.length === 0 && open.subTitle === null) {
		// A section that is only a header for its sub-sections carries no items of its own — no empty card.
		return null;
	}
	const body = items.map((line) => line.replace(/^- \[x\]\s*/u, "- ")).join("\n");
	const sectionSlug = slugifyDoneHeading(open.sectionTitle);
	const id =
		open.subTitle === null ? `done:${sectionSlug}` : `done:${sectionSlug}--${slugifyDoneHeading(open.subTitle)}`;
	const where =
		open.subTitle === null
			? `section "${open.sectionTitle}"`
			: `section "${open.sectionTitle}", milestone "${open.subTitle}"`;
	return {
		id,
		title: open.subTitle === null ? open.sectionTitle : `${open.sectionTitle} — ${open.subTitle}`,
		prompt: `${items.length} shipped item(s) — from done.md, ${where}.\n\n${clampPrompt(body)}`,
		itemCount: items.length,
	};
}

/**
 * Parse done.md into work packages: one per `## ` section, plus one per `### ` milestone inside it (in document
 * order). A section's own items — those before its first `### ` — form the section package; a section with no
 * items of its own and only milestones yields just the milestones.
 */
export function parseDoneMarkdownPackages(
	markdown: string,
	clampPrompt: (text: string) => string = (text) => text,
): DonePackage[] {
	const packages: DonePackage[] = [];
	let open: OpenPackage | null = null;
	const flush = (): void => {
		if (open) {
			const done = finish(open, clampPrompt);
			if (done) {
				packages.push(done);
			}
		}
	};
	for (const line of markdown.split("\n")) {
		if (line.startsWith("## ")) {
			flush();
			open = { sectionTitle: line.slice(3).trim(), subTitle: null, lines: [] };
		} else if (line.startsWith("### ") && open) {
			flush();
			open = { sectionTitle: open.sectionTitle, subTitle: line.slice(4).trim(), lines: [] };
		} else if (open) {
			open.lines.push(line);
		}
	}
	flush();
	return packages;
}
