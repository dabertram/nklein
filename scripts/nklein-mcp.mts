#!/usr/bin/env tsx
/**
 * F2.30 (c) — the nklein-control MCP server, stdio transport.
 *
 * Point any MCP client at this script to drive a RUNNING local !Klein: one tool per control-registry action
 * (runtime_status, start_card, stop_card, pause_card, resume_card, move_card, set_max_concurrent_tasks).
 *
 * Claude Code registration example:
 *   claude mcp add nklein -- npx tsx scripts/nklein-mcp.mts
 * Environment:
 *   NKLEIN_MCP_BASE_URL      base URL of the running !Klein server (default http://127.0.0.1:3000; loopback only)
 *   NKLEIN_MCP_WORKSPACE_ID  workspace/project id to control (default "ws")
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildNKleinControlMcpServer, createHttpNKleinControlDeps } from "../src/mcp/nklein-control-mcp";

const baseUrl = process.env.NKLEIN_MCP_BASE_URL?.trim() || "http://127.0.0.1:3000";
const workspaceId = process.env.NKLEIN_MCP_WORKSPACE_ID?.trim() || "ws";

const server = buildNKleinControlMcpServer(createHttpNKleinControlDeps({ baseUrl, workspaceId }));
await server.connect(new StdioServerTransport());
process.stderr.write(`nklein-control MCP serving over stdio → ${baseUrl} (workspace ${workspaceId})\n`);
