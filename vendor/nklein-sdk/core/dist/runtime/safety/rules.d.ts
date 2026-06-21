import type { RuleConfig, UserInstructionConfigWatcher } from "../../extensions/config/user-instruction-config-loader";
export declare function isRuleEnabled(rule: RuleConfig): boolean;
export declare function formatRulesForSystemPrompt(rules: ReadonlyArray<RuleConfig>): string;
export declare function mergeRulesForSystemPrompt(primaryRules?: string, additionalRules?: string): string | undefined;
export declare function listEnabledRulesFromWatcher(watcher: UserInstructionConfigWatcher): RuleConfig[];
export declare function loadRulesForSystemPromptFromWatcher(watcher: UserInstructionConfigWatcher): string;
