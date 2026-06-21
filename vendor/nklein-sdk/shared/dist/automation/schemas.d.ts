import { z } from "zod";
export declare const AutomationOneOffFrontmatterSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    prompt: z.ZodOptional<z.ZodString>;
    workspaceRoot: z.ZodOptional<z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
    modelSelection: z.ZodOptional<z.ZodObject<{
        providerId: z.ZodString;
        modelId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        act: "act";
        plan: "plan";
        yolo: "yolo";
        zen: "zen";
    }>>;
    timeoutSeconds: z.ZodOptional<z.ZodNumber>;
    maxIterations: z.ZodOptional<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
export declare const AutomationScheduleFrontmatterSchema: z.ZodObject<{
    schedule: z.ZodString;
    timezone: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    prompt: z.ZodOptional<z.ZodString>;
    workspaceRoot: z.ZodOptional<z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
    modelSelection: z.ZodOptional<z.ZodObject<{
        providerId: z.ZodString;
        modelId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        act: "act";
        plan: "plan";
        yolo: "yolo";
        zen: "zen";
    }>>;
    timeoutSeconds: z.ZodOptional<z.ZodNumber>;
    maxIterations: z.ZodOptional<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
export declare const AutomationEventFrontmatterSchema: z.ZodObject<{
    event: z.ZodString;
    filters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    debounceSeconds: z.ZodOptional<z.ZodNumber>;
    dedupeWindowSeconds: z.ZodOptional<z.ZodNumber>;
    cooldownSeconds: z.ZodOptional<z.ZodNumber>;
    maxParallel: z.ZodOptional<z.ZodNumber>;
    id: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    prompt: z.ZodOptional<z.ZodString>;
    workspaceRoot: z.ZodOptional<z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
    modelSelection: z.ZodOptional<z.ZodObject<{
        providerId: z.ZodString;
        modelId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        act: "act";
        plan: "plan";
        yolo: "yolo";
        zen: "zen";
    }>>;
    timeoutSeconds: z.ZodOptional<z.ZodNumber>;
    maxIterations: z.ZodOptional<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
/**
 * Field names that are only valid on schedule specs.
 */
export declare const SCHEDULE_ONLY_FIELDS: readonly ["schedule", "timezone"];
/**
 * Field names that are only valid on event specs.
 */
export declare const EVENT_ONLY_FIELDS: readonly ["event", "filters", "debounceSeconds", "dedupeWindowSeconds", "cooldownSeconds", "maxParallel"];
export type AutomationOneOffFrontmatter = z.infer<typeof AutomationOneOffFrontmatterSchema>;
export type AutomationScheduleFrontmatter = z.infer<typeof AutomationScheduleFrontmatterSchema>;
export type AutomationEventFrontmatter = z.infer<typeof AutomationEventFrontmatterSchema>;
