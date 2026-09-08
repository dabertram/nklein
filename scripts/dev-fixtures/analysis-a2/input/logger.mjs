export const logLevel = "info";

export function log(message) {
	process.stdout.write(`${message}\n`);
}
