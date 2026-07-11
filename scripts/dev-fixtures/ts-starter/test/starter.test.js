import test from "node:test";
import assert from "node:assert/strict";
import { PROJECT_STARTED } from "../src/index.ts";

// Placeholder so `npm test` passes on the empty starter (the runner fails on zero test files). The agent REPLACES this
// with real tests for the domain modules it builds per specification.md.
test("toolchain is wired", () => {
	assert.equal(PROJECT_STARTED, true);
});
