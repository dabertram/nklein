import { useCallback, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampBetween } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadBooleanResizePreference,
	loadResizePreference,
	persistBooleanResizePreference,
	persistResizePreference,
	type ResizeBooleanPreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

// The board-independent chat lives in a resizeable right sidebar (todo §5.M). Wider range than the project nav since
// it shows a session list + transcript + composer side by side.
const CHAT_SIDEBAR_MIN_WIDTH = 320;
const CHAT_SIDEBAR_MAX_WIDTH = 900;
const CHAT_SIDEBAR_DEFAULT_WIDTH_FALLBACK = 440;

function getDefaultChatSidebarWidth(): number {
	if (typeof window === "undefined" || !Number.isFinite(window.innerWidth)) {
		return CHAT_SIDEBAR_DEFAULT_WIDTH_FALLBACK;
	}
	// ~28% of the viewport, clamped — leaves the board the majority of the width.
	return clampBetween(Math.round(window.innerWidth * 0.28), CHAT_SIDEBAR_MIN_WIDTH, CHAT_SIDEBAR_MAX_WIDTH);
}

export const CHAT_SIDEBAR_WIDTH_BOUNDS = { min: CHAT_SIDEBAR_MIN_WIDTH, max: CHAT_SIDEBAR_MAX_WIDTH };

const CHAT_SIDEBAR_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ChatSidebarWidth,
	defaultValue: getDefaultChatSidebarWidth,
	normalize: (value) => clampBetween(value, CHAT_SIDEBAR_MIN_WIDTH, CHAT_SIDEBAR_MAX_WIDTH),
};

const CHAT_SIDEBAR_COLLAPSED_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.ChatSidebarCollapsed,
	// Collapsed by default so the chat doesn't steal board width until the user opens it.
	defaultValue: true,
};

export function useChatSidebarLayout(): {
	width: number;
	isCollapsed: boolean;
	setWidth: (width: number) => void;
	setCollapsed: (collapsed: boolean) => void;
} {
	const [width, setWidthState] = useState(() => loadResizePreference(CHAT_SIDEBAR_WIDTH_PREFERENCE));
	const [isCollapsed, setIsCollapsedState] = useState(() =>
		loadBooleanResizePreference(CHAT_SIDEBAR_COLLAPSED_PREFERENCE),
	);

	const setCollapsed = useCallback((collapsed: boolean) => {
		setIsCollapsedState(persistBooleanResizePreference(CHAT_SIDEBAR_COLLAPSED_PREFERENCE, collapsed));
	}, []);

	const setWidth = useCallback((next: number) => {
		setWidthState(persistResizePreference(CHAT_SIDEBAR_WIDTH_PREFERENCE, next));
	}, []);

	useLayoutResetEffect(() => {
		setWidthState(getResizePreferenceDefaultValue(CHAT_SIDEBAR_WIDTH_PREFERENCE));
		setIsCollapsedState(CHAT_SIDEBAR_COLLAPSED_PREFERENCE.defaultValue);
	});

	return { width, isCollapsed, setWidth, setCollapsed };
}
