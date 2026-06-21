/**
 * VCR (Video Cassette Recorder) for HTTP requests.
 *
 * Patches `globalThis.fetch` to record and replay HTTP interactions,
 * enabling deterministic testing without making real API calls.
 *
 * Unlike nock (which patches Node's `http` module), this works by wrapping
 * `globalThis.fetch` directly — catching all HTTP traffic in this codebase
 * including calls made through the OpenAI, Anthropic, Gemini, and Vercel AI
 * SDKs (all of which delegate to the global fetch).
 *
 * Environment variables:
 *   NKLEIN_VCR           - "record" to record HTTP requests, "playback" to replay them
 *   NKLEIN_VCR_CASSETTE  - Path to the cassette file (default: ./vcr-cassette.json)
 *   NKLEIN_VCR_FILTER    - Substring to filter recorded/replayed request paths.
 *                         When set to a non-empty string, only requests whose path
 *                         contains this substring are recorded/replayed; all other
 *                         requests pass through to the real network.
 *                         When empty or unset, ALL requests are intercepted (no filter).
 *   NKLEIN_VCR_SSE_DELAY - Milliseconds between SSE chunks during playback (default: 100).
 *                         Set to 0 for instant delivery.
 *
 * Usage:
 *   # Record only inference requests
 *   NKLEIN_VCR=record NKLEIN_VCR_CASSETTE=./fixtures/my-test.json clite task "hello"
 *
 *   # Replay — auth/S3/etc. requests go through normally, only inference is mocked
 *   NKLEIN_VCR=playback NKLEIN_VCR_CASSETTE=./fixtures/my-test.json clite task "hello"
 *
 *   # Record everything (no filter)
 *   NKLEIN_VCR=record NKLEIN_VCR_FILTER="" NKLEIN_VCR_CASSETTE=./fixtures/all.json clite task "hello"
 */
/**
 * Initialize VCR mode based on environment variables.
 * Must be called early in startup, before HTTP requests are made.
 *
 * Does nothing if `NKLEIN_VCR` is not set.
 */
export declare function initVcr(vcrMode: string | undefined): void;
