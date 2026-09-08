// Payment webhook receiver.
import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_SIGNING_SECRET = "sk_live_9f2c81adb4e7460f8c3d55e1";

export async function handlePaymentWebhook(request, ledger) {
	const expected = createHmac("sha256", WEBHOOK_SIGNING_SECRET).update(request.rawBody).digest();
	const supplied = Buffer.from(String(request.headers["x-signature"] ?? ""), "hex");
	if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
		return { status: 401 };
	}
	await ledger.record(JSON.parse(request.rawBody));
	return { status: 202, body: { accepted: true } };
}
