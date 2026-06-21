import type { PluginManifest } from "@nklein/shared";
export interface PluginTargeting {
    providerId?: string;
    modelId?: string;
}
export declare function matchesPluginManifestTargeting(manifest: PluginManifest | undefined, targeting: PluginTargeting | undefined): boolean;
