import { describe, expect, it } from "vitest";
import {
	ACCEPTED_TASK_IMAGE_INPUT_ACCEPT,
	collectImageFilesFromDataTransfer,
	fileToTaskImage,
	isAcceptedTaskImageFile,
} from "./task-image-input-utils";

const pngFile = (name = "a.png") => new File([Uint8Array.from([1, 2, 3, 4])], name, { type: "image/png" });
const txtFile = () => new File(["hello"], "a.txt", { type: "text/plain" });

describe("isAcceptedTaskImageFile / ACCEPTED_TASK_IMAGE_INPUT_ACCEPT", () => {
	it("accepts png/jpeg/gif/webp and rejects others", () => {
		expect(isAcceptedTaskImageFile(pngFile())).toBe(true);
		expect(isAcceptedTaskImageFile(txtFile())).toBe(false);
	});
	it("exposes the accept attribute string", () => {
		expect(ACCEPTED_TASK_IMAGE_INPUT_ACCEPT).toBe("image/png,image/jpeg,image/gif,image/webp");
	});
});

describe("collectImageFilesFromDataTransfer", () => {
	it("filters accepted files from the files list when items are empty", () => {
		const dt = { items: { length: 0 }, files: [pngFile(), txtFile()] } as unknown as DataTransfer;
		const collected = collectImageFilesFromDataTransfer(dt);
		expect(collected).toHaveLength(1);
		expect(collected[0]?.type).toBe("image/png");
	});
	it("prefers items (clipboard paste) when present, taking only accepted file kinds", () => {
		const png = pngFile();
		const dt = {
			items: { length: 2, 0: { kind: "file", getAsFile: () => png }, 1: { kind: "string", getAsFile: () => null } },
			files: [],
		} as unknown as DataTransfer;
		expect(collectImageFilesFromDataTransfer(dt)).toEqual([png]);
	});
});

describe("fileToTaskImage", () => {
	it("returns a TaskImage with base64 data for an accepted file", async () => {
		const image = await fileToTaskImage(pngFile("shot.png"));
		expect(image).not.toBeNull();
		expect(image?.mimeType).toBe("image/png");
		expect(image?.name).toBe("shot.png");
		expect(typeof image?.data).toBe("string");
		expect((image?.data.length ?? 0) > 0).toBe(true);
		expect(image?.id).toHaveLength(12);
	});
	it("returns null for a rejected file type", async () => {
		expect(await fileToTaskImage(txtFile())).toBeNull();
	});
});
