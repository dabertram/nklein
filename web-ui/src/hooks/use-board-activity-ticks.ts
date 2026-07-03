// §5.BB phase 2 — the live ACTIVITY TICK feed: watches the board+session snapshots the app already polls and
// accumulates the pure diff (`diffBoardActivity`) into a capped rolling feed the chat transcript interleaves.
// Client-side derivation only — nothing is persisted; a reload starts the feed fresh (by design: ticks are the
// "what's happening right now" pulse, the durable history lives on the board/git).

import { useEffect, useRef, useState } from "react";

import {
	type ActivityTick,
	appendActivityTicks,
	type BoardActivitySnapshot,
	diffBoardActivity,
} from "@/components/chat/board-activity-ticker";

export function useBoardActivityTicks(snapshot: BoardActivitySnapshot): readonly ActivityTick[] {
	const [ticks, setTicks] = useState<readonly ActivityTick[]>([]);
	const previousRef = useRef<BoardActivitySnapshot | null>(null);

	useEffect(() => {
		const fresh = diffBoardActivity(previousRef.current, snapshot, Date.now());
		previousRef.current = snapshot;
		if (fresh.length > 0) {
			setTicks((feed) => appendActivityTicks(feed, fresh));
		}
	}, [snapshot]);

	return ticks;
}
