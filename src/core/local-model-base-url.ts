import { isIP } from "node:net";

function isPrivateIpv4(hostname: string): boolean {
	const octets = hostname.split(".").map(Number);
	if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	return (
		octets[0] === 10 ||
		octets[0] === 127 ||
		(octets[0] === 169 && octets[1] === 254) ||
		(octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
		(octets[0] === 192 && octets[1] === 168)
	);
}

/** Reject public model endpoints for benchmark lanes that are explicitly local/private-only. */
export function assertLocalModelBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Model base URL must be a valid URL.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Model base URL must use http or https.");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("Model base URL cannot contain credentials, a query, or a fragment.");
	}
	const hostname = url.hostname.toLowerCase();
	const ipVersion = isIP(hostname);
	const localHostname = hostname === "localhost" || hostname.endsWith(".local") || !hostname.includes(".");
	const localIp =
		ipVersion === 4
			? isPrivateIpv4(hostname)
			: ipVersion === 6 && (hostname === "::1" || hostname.startsWith("fe80:"));
	if (!localHostname && !localIp) {
		throw new Error("Model base URL must address loopback, a private LAN IP, or a local hostname.");
	}
	return url.toString().replace(/\/$/, "");
}
