import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LockOptions } from "proper-lockfile";
import * as lockfile from "proper-lockfile";
import { recordSelfObservation } from "../telemetry/self-observation-sink";

const DEFAULT_LOCK_STALE_MS = 10_000;
const EMPTY_HELD_KEYS: ReadonlySet<string> = new Set<string>();
const DEFAULT_LOCK_RETRIES: NonNullable<LockOptions["retries"]> = {
	retries: 200,
	factor: 1,
	minTimeout: 25,
	maxTimeout: 50,
	randomize: false,
};

interface BaseLockRequest {
	path: string;
	staleMs?: number;
	retries?: LockOptions["retries"];
	onCompromised?: LockOptions["onCompromised"];
}

export interface FileLockRequest extends BaseLockRequest {
	type?: "file";
	lockfilePath?: string;
}

export interface DirectoryLockRequest extends BaseLockRequest {
	type: "directory";
	lockfileName?: string;
	lockfilePath?: string;
}

export type LockRequest = FileLockRequest | DirectoryLockRequest;

interface NormalizedLockRequest {
	path: string;
	options: LockOptions;
	sortKey: string;
}

export interface AtomicTextWriteOptions {
	lock?: LockRequest | null;
	executable?: boolean;
}

function defaultOnCompromised(lockfilePath: string): NonNullable<LockOptions["onCompromised"]> {
	return (error) => {
		// proper-lockfile invokes this from its mtime-refresh timer when it can no
		// longer guarantee the lock — e.g. a busy event loop (heavy local-model
		// startup, SDK host boot) let the lock go stale and another holder reclaimed
		// it, so utimes/stat on the lockfile fails with ENOENT. The library's built-in
		// default rethrows, but it does so from inside a setTimeout callback, which
		// becomes an uncaught exception and kills the entire runtime process.
		// Record it as an anomaly instead of crashing: every write here is atomic
		// (temp file + rename), so the worst case of a momentarily lost lock is a
		// lost update, never a corrupt file — vastly preferable to taking down the
		// runtime mid-task.
		const message = error instanceof Error ? error.message : String(error);
		recordSelfObservation({
			signal: "runtime_error",
			severity: "warning",
			message: `Lock compromised for ${lockfilePath}: ${message}`,
			metadata: { lockfilePath },
		});
	};
}

function createLockOptions(request: LockRequest, lockfilePath: string): LockOptions {
	return {
		stale: request.staleMs ?? DEFAULT_LOCK_STALE_MS,
		retries: request.retries ?? DEFAULT_LOCK_RETRIES,
		realpath: false,
		lockfilePath,
		onCompromised: request.onCompromised ?? defaultOnCompromised(lockfilePath),
	};
}

async function readFileIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export class LockedFileSystem {
	// `proper-lockfile` is a *cross-process* lock (a directory on disk); it is the wrong tool for serializing the
	// many concurrent callers inside a single runtime process (e.g. the swarm running several cards at once, all
	// persisting board state). Racing the file lock from the same process means each waiter busy-retries and, when
	// a holder holds longer than the retry window, throws `ELOCKED` ("Lock file is already being held") — which
	// surfaced as queued task-starts failing and second-opinion reviews being skipped under concurrency. So we
	// gate every lock request through an in-process FIFO mutex per lockfile first: same-process callers queue in
	// order (no busy-retry, no spurious timeout) and the on-disk file lock is only ever contended *across*
	// processes. Keyed by `sortKey` (the lockfile path); multi-lock requests claim their keys in sorted order, so
	// the in-process gates are deadlock-free for the same reason the file locks are.
	private readonly inProcessKeyTails = new Map<string, Promise<void>>();
	// Keys whose lock is already held by the current async call stack. A `withLock` nested inside another on the
	// SAME key is re-entrant: re-acquiring would deadlock on the in-process gate (and, before that gate existed,
	// would `ELOCKED` against proper-lockfile's own held lock). We treat it as a no-op so nested same-key access
	// from one logical flow just proceeds — the lock is still exclusive against *other* async contexts.
	private readonly heldKeysStorage = new AsyncLocalStorage<ReadonlySet<string>>();

	private acquireInProcessKey(key: string): { acquired: Promise<void>; release: () => void } {
		const previousTail = this.inProcessKeyTails.get(key) ?? Promise.resolve();
		let release!: () => void;
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const newTail = previousTail.then(() => hold);
		this.inProcessKeyTails.set(key, newTail);
		// Drop the map entry once this hold settles and nothing newer queued behind it, so the map can't grow
		// unbounded across a long-lived process.
		void newTail.then(() => {
			if (this.inProcessKeyTails.get(key) === newTail) {
				this.inProcessKeyTails.delete(key);
			}
		});
		return { acquired: previousTail, release };
	}

	private async normalizeLockRequest(request: LockRequest): Promise<NormalizedLockRequest> {
		if (request.type === "directory") {
			await mkdir(request.path, { recursive: true });
			const lockfilePath = request.lockfilePath ?? join(request.path, request.lockfileName ?? ".lock");
			return {
				path: request.path,
				options: createLockOptions(request, lockfilePath),
				sortKey: lockfilePath,
			};
		}

		await mkdir(dirname(request.path), { recursive: true });
		const lockfilePath = request.lockfilePath ?? `${request.path}.lock`;
		return {
			path: request.path,
			options: createLockOptions(request, lockfilePath),
			sortKey: lockfilePath,
		};
	}

	async withLock<T>(request: LockRequest, operation: () => Promise<T>): Promise<T> {
		return await this.withLocks([request], operation);
	}

	async withLocks<T>(requests: readonly LockRequest[], operation: () => Promise<T>): Promise<T> {
		const normalizedRequests = await Promise.all(
			requests.map(async (request) => await this.normalizeLockRequest(request)),
		);
		const orderedRequests = normalizedRequests
			.slice()
			.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
		// Skip keys already held by this async call stack (re-entrant); only newly-needed keys are acquired.
		const heldKeys = this.heldKeysStorage.getStore() ?? EMPTY_HELD_KEYS;
		const requestsToAcquire = orderedRequests.filter((request) => !heldKeys.has(request.sortKey));
		if (requestsToAcquire.length === 0) {
			return await operation();
		}
		// Claim the in-process gates synchronously, in the same sorted order as the file locks, so concurrent
		// same-process callers queue deterministically (and deadlock-free) before touching the on-disk lock.
		const inProcessGates = requestsToAcquire.map((request) => this.acquireInProcessKey(request.sortKey));
		try {
			await Promise.all(inProcessGates.map((gate) => gate.acquired));
			const releases: Array<() => Promise<void>> = [];
			try {
				for (const request of requestsToAcquire) {
					releases.push(await lockfile.lock(request.path, request.options));
				}
				const nextHeldKeys = new Set(heldKeys);
				for (const request of requestsToAcquire) {
					nextHeldKeys.add(request.sortKey);
				}
				return await this.heldKeysStorage.run(nextHeldKeys, operation);
			} finally {
				for (const release of releases.reverse()) {
					try {
						await release();
					} catch (error) {
						// A lock can be compromised mid-operation (see defaultOnCompromised);
						// proper-lockfile then rejects the release with ERELEASED because the
						// lock is already gone. There is nothing left to clean up, so swallow
						// it — letting one release rejection escape would mask the operation's
						// own result and leave sibling locks unreleased.
						const message = error instanceof Error ? error.message : String(error);
						recordSelfObservation({
							signal: "runtime_error",
							severity: "warning",
							message: `Failed to release file lock: ${message}`,
						});
					}
				}
			}
		} finally {
			// Release the in-process gates in reverse order so the next queued caller can proceed.
			for (const gate of inProcessGates.reverse()) {
				gate.release();
			}
		}
	}

	async writeTextFileAtomic(path: string, content: string, options: AtomicTextWriteOptions = {}): Promise<void> {
		const lockRequest: LockRequest | null =
			options.lock === undefined
				? {
						path,
						type: "file" as const,
					}
				: options.lock;
		const writeOperation = async () => {
			const existingContent = await readFileIfExists(path);
			if (existingContent === content) {
				if (options.executable) {
					await chmod(path, 0o755);
				}
				return;
			}
			await mkdir(dirname(path), { recursive: true });
			const tempPath = `${path}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`;
			await writeFile(tempPath, content, "utf8");
			await rename(tempPath, path);
			if (options.executable) {
				await chmod(path, 0o755);
			}
		};
		if (lockRequest) {
			await this.withLock(lockRequest, writeOperation);
			return;
		}
		await writeOperation();
	}

	async writeJsonFileAtomic(
		path: string,
		payload: unknown,
		options: Omit<AtomicTextWriteOptions, "executable"> = {},
	): Promise<void> {
		await this.writeTextFileAtomic(path, JSON.stringify(payload, null, 2), options);
	}

	async removePath(path: string, options: { lock: LockRequest; recursive?: boolean; force?: boolean }): Promise<void> {
		await this.withLock(options.lock, async () => {
			await rm(path, {
				recursive: options.recursive,
				force: options.force,
			});
		});
	}
}

export const lockedFileSystem = new LockedFileSystem();
