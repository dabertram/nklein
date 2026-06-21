import { z } from "zod";
export declare const SessionManifestSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    session_id: z.ZodString;
    source: z.ZodString;
    pid: z.ZodNumber;
    started_at: z.ZodString;
    ended_at: z.ZodOptional<z.ZodString>;
    exit_code: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    status: z.ZodEnum<{
        running: "running";
        completed: "completed";
        failed: "failed";
        cancelled: "cancelled";
    }>;
    interactive: z.ZodBoolean;
    provider: z.ZodString;
    model: z.ZodString;
    cwd: z.ZodString;
    workspace_root: z.ZodString;
    team_name: z.ZodOptional<z.ZodString>;
    enable_tools: z.ZodBoolean;
    enable_spawn: z.ZodBoolean;
    enable_teams: z.ZodBoolean;
    prompt: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    messages_path: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SessionManifest = z.infer<typeof SessionManifestSchema>;
