import { describe, expect, it } from "vitest";
import { formatNotificationPermissionStatus } from "./notification-permission";

describe("formatNotificationPermissionStatus", () => {
	it("renders 'default' as 'not requested yet'", () => {
		expect(formatNotificationPermissionStatus("default")).toBe("not requested yet");
	});

	it("passes through the concrete permission states", () => {
		expect(formatNotificationPermissionStatus("granted")).toBe("granted");
		expect(formatNotificationPermissionStatus("denied")).toBe("denied");
		expect(formatNotificationPermissionStatus("unsupported")).toBe("unsupported");
	});
});
