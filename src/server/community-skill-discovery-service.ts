/** F4.21 production composition: discovery can reach the network only through the existing egress-gated SearXNG client. */

import {
	discoverCommunitySkills,
	type SkillDiscoveryRequest,
	type SkillDiscoveryResponse,
} from "../core/community-skill-discovery";
import { createSearxngWebSearchClient, type SearxngWebSearchClientOptions } from "./web-search-searxng";

export interface CommunitySkillDiscoveryService {
	discover(request: SkillDiscoveryRequest): Promise<SkillDiscoveryResponse>;
}

export function createCommunitySkillDiscoveryService(
	options: SearxngWebSearchClientOptions,
): CommunitySkillDiscoveryService {
	const broker = createSearxngWebSearchClient(options);
	return {
		discover: async (request) => await discoverCommunitySkills(request, broker),
	};
}
