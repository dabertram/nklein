import type { SessionBackend } from "./session-record";
export declare function invokeBackend<T>(backend: SessionBackend, method: string, ...args: unknown[]): Promise<T>;
export declare function invokeBackendOptional(backend: SessionBackend, method: string, ...args: unknown[]): Promise<void>;
export declare function invokeBackendOptionalValue<T = unknown>(backend: SessionBackend, method: string, ...args: unknown[]): Promise<T | undefined>;
