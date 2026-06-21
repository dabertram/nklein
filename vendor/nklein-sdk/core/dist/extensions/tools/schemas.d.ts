/**
 * Zod Schemas for Default Tool Inputs
 *
 * These schemas define the input structure for each default tool
 * and are used for both validation and JSON Schema generation.
 */
import { z } from "zod";
export declare const INPUT_ARG_CHAR_LIMIT = 6000;
export declare const ReadFileLineRangeSchema: z.ZodObject<{
    start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>;
export declare const ReadFileRequestSchema: z.ZodObject<{
    path: z.ZodString;
    start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>;
/**
 * Schema for read_files tool input
 */
export declare const ReadFilesInputSchema: z.ZodObject<{
    files: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Union schema for read_files tool input, allowing either a single string, an array of strings, or the full object schema
 */
export declare const ReadFilesInputUnionSchema: z.ZodUnion<readonly [z.ZodObject<{
    files: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    path: z.ZodString;
    start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>, z.ZodArray<z.ZodObject<{
    path: z.ZodString;
    start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>>, z.ZodArray<z.ZodString>, z.ZodString, z.ZodObject<{
    files: z.ZodObject<{
        path: z.ZodString;
        start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    file_paths: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    file_paths: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    paths: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        path: z.ZodString;
        start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>]>>;
}, z.core.$strip>, z.ZodObject<{
    paths: z.ZodObject<{
        path: z.ZodString;
        start_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        end_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    paths: z.ZodString;
}, z.core.$strip>]>;
/**
 * Schema for search_codebase tool input
 */
export declare const SearchCodebaseInputSchema: z.ZodObject<{
    queries: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/**
 * Union schema for search_codebase tool input, allowing either a single string, an array of strings, or the full object schema
 */
export declare const SearchCodebaseUnionInputSchema: z.ZodUnion<readonly [z.ZodObject<{
    queries: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodArray<z.ZodString>, z.ZodString, z.ZodObject<{
    queries: z.ZodString;
}, z.core.$strip>]>;
/**
 * Schema for run_commands tool input
 */
export declare const RunCommandsInputSchema: z.ZodObject<{
    commands: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/**
 * Union schema for run_commands tool input. More flexible.
 */
export declare const RunCommandsInputUnionSchema: z.ZodUnion<readonly [z.ZodObject<{
    commands: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    commands: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    command: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    cmd: z.ZodString;
}, z.core.$strip>, z.ZodArray<z.ZodString>, z.ZodString]>;
export declare const StructuredCommandInputSchema: z.ZodObject<{
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const StructuredCommandEntrySchema: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>]>;
/**
 * Schema for run_commands tool input
 */
export declare const StructuredCommandsInputSchema: z.ZodObject<{
    commands: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        command: z.ZodString;
        args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>]>>;
}, z.core.$strip>;
/**
 * Union schema for run_commands tool input. More flexible.
 */
export declare const StructuredCommandsInputUnionSchema: z.ZodUnion<readonly [z.ZodObject<{
    commands: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    commands: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        command: z.ZodString;
        args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>]>>;
}, z.core.$strip>, z.ZodObject<{
    commands: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        command: z.ZodString;
        args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>]>;
}, z.core.$strip>, z.ZodArray<z.ZodObject<{
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>>, z.ZodObject<{
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>, z.ZodObject<{
    command: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    cmd: z.ZodString;
}, z.core.$strip>, z.ZodArray<z.ZodString>, z.ZodString]>;
/**
 * Schema for a single web fetch request
 */
export declare const WebFetchRequestSchema: z.ZodObject<{
    url: z.ZodString;
    prompt: z.ZodString;
}, z.core.$strip>;
/**
 * Schema for fetch_web_content tool input
 */
export declare const FetchWebContentInputSchema: z.ZodObject<{
    requests: z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        prompt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Schema for editor tool input
 */
export declare const EditFileInputSchema: z.ZodObject<{
    path: z.ZodString;
    old_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_text: z.ZodString;
    insert_line: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>;
/**
 * Schema for apply_patch tool input
 */
export declare const ApplyPatchInputSchema: z.ZodObject<{
    input: z.ZodString;
}, z.core.$strip>;
export declare const ApplyPatchInputUnionSchema: z.ZodUnion<readonly [z.ZodObject<{
    input: z.ZodString;
}, z.core.$strip>, z.ZodString]>;
/**
 * Schema for skills tool input
 */
export declare const SkillsInputSchema: z.ZodObject<{
    skill: z.ZodString;
    args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/**
 * Schema for ask_followup_question tool input
 */
export declare const AskQuestionInputSchema: z.ZodObject<{
    question: z.ZodString;
    options: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const SubmitInputSchema: z.ZodObject<{
    summary: z.ZodString;
    verified: z.ZodBoolean;
}, z.core.$strip>;
/**
 * Input for a single file read request
 */
export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>;
/**
 * Input for the read_files tool
 */
export type ReadFilesInput = z.infer<typeof ReadFilesInputSchema>;
/**
 * Input for the search_codebase tool
 */
export type SearchCodebaseInput = z.infer<typeof SearchCodebaseInputSchema>;
/**
 * Input for the run_commands tool
 */
export type RunCommandsInput = z.infer<typeof RunCommandsInputSchema>;
export type StructuredCommandInput = z.infer<typeof StructuredCommandInputSchema>;
/**
 * Web fetch request parameters
 */
export type WebFetchRequest = z.infer<typeof WebFetchRequestSchema>;
/**
 * Input for the fetch_web_content tool
 */
export type FetchWebContentInput = z.infer<typeof FetchWebContentInputSchema>;
/**
 * Input for the editor tool
 */
export type EditFileInput = z.infer<typeof EditFileInputSchema>;
/**
 * Input for the apply_patch tool
 */
export type ApplyPatchInput = z.infer<typeof ApplyPatchInputSchema>;
/**
 * Input for the skills tool
 */
export type SkillsInput = z.infer<typeof SkillsInputSchema>;
/**
 * Input for the ask_followup_question tool
 */
export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;
/**
 * Input for the submit and exit tool
 */
export type SubmitInput = z.infer<typeof SubmitInputSchema>;
