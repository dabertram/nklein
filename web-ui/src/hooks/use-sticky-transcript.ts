// §5.BB — intuitive chat scrolling (user directive): the transcript FOLLOWS live output only while the user is
// at the bottom. Scrolling up detaches (nothing scrolls away while reading at your own pace); a floating
// "↓ N new · Follow" pill re-attaches. Scrolling back to the bottom by hand re-attaches too.

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** Within this distance of the bottom the user counts as "at the bottom" (re-attach zone). */
const FOLLOW_THRESHOLD_PX = 48;

export function useStickyTranscript(input: {
	containerRef: RefObject<HTMLElement | null>;
	/** A value that changes whenever transcript content grows (message count + streaming length). */
	contentVersion: number;
	/** Reset key — a new session re-attaches and clears the new-count. */
	resetKey: string | null;
}): {
	following: boolean;
	/** Messages that arrived while detached (shown on the Follow pill). */
	newCount: number;
	/** Re-attach: scroll to the end and follow live output again. */
	follow: () => void;
	/** The container's onScroll handler. */
	handleScroll: () => void;
} {
	const [following, setFollowing] = useState(true);
	const [newCount, setNewCount] = useState(0);
	const lastVersionRef = useRef(input.contentVersion);

	const isAtBottom = useCallback((): boolean => {
		const container = input.containerRef.current;
		if (!container) {
			return true;
		}
		return container.scrollHeight - container.scrollTop - container.clientHeight <= FOLLOW_THRESHOLD_PX;
	}, [input.containerRef]);

	const follow = useCallback(() => {
		const container = input.containerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
		setFollowing(true);
		setNewCount(0);
	}, [input.containerRef]);

	const handleScroll = useCallback(() => {
		const atBottom = isAtBottom();
		setFollowing((current) => {
			if (current && !atBottom) {
				return false;
			}
			if (!current && atBottom) {
				setNewCount(0);
				return true;
			}
			return current;
		});
	}, [isAtBottom]);

	// New session ⇒ jump to the latest and re-attach.
	useEffect(() => {
		follow();
	}, [input.resetKey, follow]);

	// Content grew: follow when attached; count the arrivals when detached.
	useEffect(() => {
		if (input.contentVersion === lastVersionRef.current) {
			return;
		}
		const grew = input.contentVersion > lastVersionRef.current;
		lastVersionRef.current = input.contentVersion;
		if (!grew) {
			return;
		}
		if (following) {
			const container = input.containerRef.current;
			if (container) {
				container.scrollTop = container.scrollHeight;
			}
		} else {
			setNewCount((count) => count + 1);
		}
	}, [input.contentVersion, following, input.containerRef]);

	return { following, newCount, follow, handleScroll };
}
