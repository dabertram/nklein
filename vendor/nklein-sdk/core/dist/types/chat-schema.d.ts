import { z } from "zod";
export declare const ChatSessionConfigSchema: z.ZodObject<{
    workspaceRoot: z.ZodString;
    cwd: z.ZodOptional<z.ZodString>;
    provider: z.ZodString;
    model: z.ZodString;
    mode: z.ZodDefault<z.ZodEnum<{
        act: "act";
        plan: "plan";
    }>>;
    apiKey: z.ZodString;
    systemPrompt: z.ZodOptional<z.ZodString>;
    rules: z.ZodOptional<z.ZodString>;
    maxIterations: z.ZodOptional<z.ZodNumber>;
    enableTools: z.ZodBoolean;
    enableSpawn: z.ZodOptional<z.ZodBoolean>;
    enableTeams: z.ZodOptional<z.ZodBoolean>;
    autoApproveTools: z.ZodOptional<z.ZodBoolean>;
    missionStepInterval: z.ZodOptional<z.ZodNumber>;
    missionTimeIntervalMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const ChatSessionStatusSchema: z.ZodEnum<{
    error: "error";
    idle: "idle";
    running: "running";
    completed: "completed";
    failed: "failed";
    starting: "starting";
    stopping: "stopping";
    cancelled: "cancelled";
}>;
export declare const ChatMessageRoleSchema: z.ZodEnum<{
    system: "system";
    status: "status";
    error: "error";
    user: "user";
    assistant: "assistant";
    tool: "tool";
}>;
export declare const ChatMessageSchema: z.ZodObject<{
    id: z.ZodString;
    sessionId: z.ZodNullable<z.ZodString>;
    role: z.ZodEnum<{
        system: "system";
        status: "status";
        error: "error";
        user: "user";
        assistant: "assistant";
        tool: "tool";
    }>;
    content: z.ZodString;
    createdAt: z.ZodNumber;
    meta: z.ZodOptional<z.ZodObject<{
        stream: z.ZodOptional<z.ZodEnum<{
            stdout: "stdout";
            stderr: "stderr";
        }>>;
        toolName: z.ZodOptional<z.ZodString>;
        iteration: z.ZodOptional<z.ZodNumber>;
        agentId: z.ZodOptional<z.ZodString>;
        conversationId: z.ZodOptional<z.ZodString>;
        hookEventName: z.ZodOptional<z.ZodString>;
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
        checkpoint: z.ZodOptional<z.ZodObject<{
            ref: z.ZodString;
            createdAt: z.ZodNumber;
            runCount: z.ZodNumber;
            kind: z.ZodOptional<z.ZodEnum<{
                commit: "commit";
                stash: "stash";
            }>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const ChatSummarySchema: z.ZodObject<{
    toolCalls: z.ZodNumber;
    tokensIn: z.ZodNumber;
    tokensOut: z.ZodNumber;
}, z.core.$strip>;
export declare const ChatViewStateSchema: z.ZodObject<{
    sessionId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        error: "error";
        idle: "idle";
        running: "running";
        completed: "completed";
        failed: "failed";
        starting: "starting";
        stopping: "stopping";
        cancelled: "cancelled";
    }>;
    config: z.ZodObject<{
        workspaceRoot: z.ZodString;
        cwd: z.ZodOptional<z.ZodString>;
        provider: z.ZodString;
        model: z.ZodString;
        mode: z.ZodDefault<z.ZodEnum<{
            act: "act";
            plan: "plan";
        }>>;
        apiKey: z.ZodString;
        systemPrompt: z.ZodOptional<z.ZodString>;
        rules: z.ZodOptional<z.ZodString>;
        maxIterations: z.ZodOptional<z.ZodNumber>;
        enableTools: z.ZodBoolean;
        enableSpawn: z.ZodOptional<z.ZodBoolean>;
        enableTeams: z.ZodOptional<z.ZodBoolean>;
        autoApproveTools: z.ZodOptional<z.ZodBoolean>;
        missionStepInterval: z.ZodOptional<z.ZodNumber>;
        missionTimeIntervalMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sessionId: z.ZodNullable<z.ZodString>;
        role: z.ZodEnum<{
            system: "system";
            status: "status";
            error: "error";
            user: "user";
            assistant: "assistant";
            tool: "tool";
        }>;
        content: z.ZodString;
        createdAt: z.ZodNumber;
        meta: z.ZodOptional<z.ZodObject<{
            stream: z.ZodOptional<z.ZodEnum<{
                stdout: "stdout";
                stderr: "stderr";
            }>>;
            toolName: z.ZodOptional<z.ZodString>;
            iteration: z.ZodOptional<z.ZodNumber>;
            agentId: z.ZodOptional<z.ZodString>;
            conversationId: z.ZodOptional<z.ZodString>;
            hookEventName: z.ZodOptional<z.ZodString>;
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            checkpoint: z.ZodOptional<z.ZodObject<{
                ref: z.ZodString;
                createdAt: z.ZodNumber;
                runCount: z.ZodNumber;
                kind: z.ZodOptional<z.ZodEnum<{
                    commit: "commit";
                    stash: "stash";
                }>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    rawTranscript: z.ZodString;
    error: z.ZodNullable<z.ZodString>;
    summary: z.ZodObject<{
        toolCalls: z.ZodNumber;
        tokensIn: z.ZodNumber;
        tokensOut: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ChatSessionConfig = z.infer<typeof ChatSessionConfigSchema>;
export type ChatSessionStatus = z.infer<typeof ChatSessionStatusSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSummary = z.infer<typeof ChatSummarySchema>;
export type ChatViewState = z.infer<typeof ChatViewStateSchema>;
