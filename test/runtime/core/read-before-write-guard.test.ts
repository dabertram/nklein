import { describe, expect, it } from "vitest";
import {
	assessWriteGrounding,
	createReadBeforeWriteState,
	recordFileRead,
	recordFileWrite,
} from "../../../src/core/read-before-write-guard";

const T0 = 1_800_000_000_000;

describe("read-before-write guard (F12.19)", () => {
	it("flags a write to an existing file the session never read", () => {
		const state = createReadBeforeWriteState();
		const verdict = assessWriteGrounding(state, "src/a.ts", { currentMtime: T0 });
		expect(verdict.kind).toBe("never_read");
	});

	it("grounds a write that follows a current read, and a new-file write trivially", () => {
		const state = createReadBeforeWriteState();
		recordFileRead(state, "src/a.ts", { mtime: T0, now: T0 + 1 });
		expect(assessWriteGrounding(state, "src/a.ts", { currentMtime: T0 }).kind).toBe("grounded");
		expect(assessWriteGrounding(state, "src/new.ts", { currentMtime: null }).kind).toBe("grounded");
	});

	it("flags a STALE read when the file changed after it was read, and recovers after re-read or write", () => {
		const state = createReadBeforeWriteState();
		recordFileRead(state, "src/a.ts", { mtime: T0, now: T0 + 1 });
		expect(assessWriteGrounding(state, "src/a.ts", { currentMtime: T0 + 500 }).kind).toBe("stale_read");
		// The session's own successful write refreshes grounding.
		recordFileWrite(state, "src/a.ts", { mtimeAfterWrite: T0 + 600, now: T0 + 601 });
		expect(assessWriteGrounding(state, "src/a.ts", { currentMtime: T0 + 600 }).kind).toBe("grounded");
	});

	it("degrades gracefully when mtimes are unknown — the read wins the tie", () => {
		const state = createReadBeforeWriteState();
		recordFileRead(state, "src/a.ts", { mtime: null, now: T0 });
		expect(assessWriteGrounding(state, "src/a.ts", { currentMtime: T0 + 999 }).kind).toBe("grounded");
	});
});
