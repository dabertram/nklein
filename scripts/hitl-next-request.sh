#!/bin/bash
# Block until the HITL rig has a request waiting for an answer, then print its id.
#
# ── WHY ──
# The rig's model seat is filled by an AGENT, and an agent's turn ends when it stops calling tools. Three separate
# responder runs (2026-09-08) answered one request and then ended the turn with "resuming the watch" — nothing was
# watching, and the factory sat idle for hours behind a model that had gone home. Telling the responder to "poll"
# does not fix it: polling with `sleep` between tool calls still ends the turn on the last call.
#
# The fix is to give the responder ONE blocking call. A foreground command that does not return until there is work
# holds the turn open by construction, so the loop cannot be forgotten. This is the same shape as `hitl-wait.sh`
# (which waits on the factory) pointed the other way: it waits on the QUEUE, for the model.
#
# Usage:  scripts/hitl-next-request.sh <mark> [maxWaitSeconds]
#   <mark>  answer only ids strictly greater than this (scopes a capture to one project)
# Prints:  the lowest unanswered request id > mark, or "NONE" if none appeared before the deadline.
# Exit:    0 when an id is printed, 3 on timeout (so `|| ` can distinguish "idle" from "error").
set -u
QUEUE="${HITL_QUEUE:-$HOME/.nklein/factory-drains/hitl-drain/queue}"
MARK="${1:-0}"
MAX_WAIT="${2:-540}"   # default under the 600s tool cap so the call returns rather than being killed
POLL="${HITL_POLL_SECONDS:-5}"

deadline=$(( $(date +%s) + MAX_WAIT ))
while :; do
	next=""
	for dir in pending done; do
		[ -d "$QUEUE/$dir" ] || continue
		for path in "$QUEUE/$dir"/*.json; do
			[ -e "$path" ] || continue
			id="${path##*/}"; id="${id%.json}"
			case "$id" in (*[!0-9]*) continue;; esac
			[ "$id" -gt "$MARK" ] || continue
			[ -f "$QUEUE/answers/$id.json" ] && continue
			if [ -z "$next" ] || [ "$id" -lt "$next" ]; then next="$id"; fi
		done
	done
	if [ -n "$next" ]; then echo "$next"; exit 0; fi
	[ "$(date +%s)" -ge "$deadline" ] && { echo "NONE"; exit 3; }
	sleep "$POLL"
done
