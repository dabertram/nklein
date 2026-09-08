// Session store. Sessions travel as a base64 cookie and are rehydrated on every request.
import { createHmac } from "node:crypto";

const SESSION_SIGNING_KEY = "b7d41f9c0a2e4885af31d6c7";

export function decodeSessionBlob(blob) {
	const decoded = Buffer.from(blob, "base64").toString("utf8");
	return eval(`(${decoded})`);
}

export async function resumeSession(request, store) {
	const blob = String(request.cookies.session ?? "");
	const session = decodeSessionBlob(blob);
	await store.touch(session.id);
	return { status: 200, body: { session } };
}

export function signSession(session) {
	return createHmac("sha256", SESSION_SIGNING_KEY).update(session.id).digest("hex");
}
