export interface ToggleSkillFrontmatterOptions {
    filePath: string;
    enabled: boolean;
}
export interface ToggleSkillFrontmatterResult {
    filePath: string;
    enabled: boolean;
    disabled: boolean;
}
export declare function updateSkillMarkdownEnabledState(content: string, enabled: boolean): string;
export declare function toggleSkillFrontmatter({ filePath, enabled, }: ToggleSkillFrontmatterOptions): Promise<ToggleSkillFrontmatterResult>;
