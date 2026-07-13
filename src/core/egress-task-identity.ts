/**
 * F2.5 (§5.L) — per-task egress IDENTITY: the host issues each task session a proxy credential, hands it to the
 * sandbox as a standard credentialed proxy URL (`http://<taskId>:<token>@proxy:port` — HTTP clients turn that
 * into `Proxy-Authorization` automatically, no in-sandbox cooperation needed), and the proxy validates the claim
 * to ATTRIBUTE every CONNECT verdict to the task that caused it. Attribution-only in this increment: an absent
 * or invalid claim audits as unattributed (`taskId: null`) and the role/allowlist policy gates exactly as
 * before — flipping auth to REQUIRED is a later, live-validated policy decision. Pure + injectable.
 */

export interface EgressTaskIdentityRegistry {
	/** Issue (or replace) the task's credential. Returns the token to embed in the sandbox's proxy URL. */
	issue: (taskId: string, token: string) => string;
	/** Validate a claimed (taskId, token) pair against the issued credential. */
	validate: (taskId: string, token: string) => boolean;
	/** Revoke the task's credential (session teardown). Idempotent. */
	revoke: (taskId: string) => void;
	clearAll: () => void;
}

/** Length-constant-ish comparison — avoids early-exit prefix leaks on the token compare. */
function tokensEqual(left: string, right: string): boolean {
	if (left.length !== right.length) {
		return false;
	}
	let diff = 0;
	for (let index = 0; index < left.length; index += 1) {
		diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return diff === 0;
}

export function createEgressTaskIdentityRegistry(): EgressTaskIdentityRegistry {
	const tokenByTaskId = new Map<string, string>();
	return {
		issue(taskId, token) {
			tokenByTaskId.set(taskId, token);
			return token;
		},
		validate(taskId, token) {
			const issued = tokenByTaskId.get(taskId);
			return issued !== undefined && tokensEqual(issued, token);
		},
		revoke(taskId) {
			tokenByTaskId.delete(taskId);
		},
		clearAll() {
			tokenByTaskId.clear();
		},
	};
}

/**
 * The credentialed proxy URL a task's sandbox receives as HTTP(S)_PROXY: standard clients emit the credentials
 * as `Proxy-Authorization: Basic …` on every request through the proxy. Components are URL-encoded so task ids
 * and tokens survive URL syntax.
 */
export function buildTaskProxyUrl(input: {
	proxyHost: string;
	proxyPort: number;
	taskId: string;
	token: string;
}): string {
	return `http://${encodeURIComponent(input.taskId)}:${encodeURIComponent(input.token)}@${input.proxyHost}:${input.proxyPort}`;
}
