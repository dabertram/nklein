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
# A second responder is worse than none. The queue is strictly serial — one request in flight — so a second
# answerer adds no throughput, only races: two responders can pick up the same id, and whichever answer lands
# second is discarded work, while a RECORDING of the drive (scripts/hitl-record-project.mts) becomes incoherent
# because the run it replays was produced by two different minds taking alternate turns. Live 2026-09-08: a second
# responder spent a full turn analysing request 613 before noticing the first had already answered it. Claiming
# makes that structural instead of conventional: `mkdir` is atomic, so exactly one caller wins each id, and a
# loser silently moves on to the next unclaimed request rather than duplicating work.
#
# Usage:  scripts/hitl-next-request.sh <mark> [maxWaitSeconds] [--claim <responderId>]
#   <mark>  answer only ids strictly greater than this (scopes a capture to one project)
#   --claim take exclusive ownership of the returned id (safe to run several responders)
# Env:    HITL_STALE_MINUTES (default 30) — ignore unanswered requests older than this; their sessions are gone.
# Prints:  the lowest unanswered request id > mark, or "NONE" if none appeared before the deadline.
# Exit:    0 when an id is printed, 3 on timeout (so `||` can distinguish "idle" from "error").
set -u
QUEUE="${HITL_QUEUE:-$HOME/.nklein/factory-drains/hitl-drain/queue}"
MARK="${1:-0}"
MAX_WAIT="${2:-540}"   # default under the 600s tool cap so the call returns rather than being killed
POLL="${HITL_POLL_SECONDS:-5}"
STALE_MINUTES="${HITL_STALE_MINUTES:-30}"   # a request older than this with no answer is a corpse, not work
CLAIM_AS=""
while [ $# -gt 0 ]; do
	case "$1" in
		--claim) CLAIM_AS="${2:-responder}"; shift 2;;
		*) shift;;
	esac
done
CLAIMS="$QUEUE/claims"

# A claim is STALE once the request it guards has an answer, or once nothing has touched it for an hour (a
# responder that died mid-turn must not wedge the seat forever, which is the failure the claim is meant to prevent).
claim_id() {
	local id="$1"
	[ -z "$CLAIM_AS" ] && return 0
	mkdir -p "$CLAIMS" 2>/dev/null
	if mkdir "$CLAIMS/$id" 2>/dev/null; then
		printf '%s\n' "$CLAIM_AS" > "$CLAIMS/$id/owner"
		return 0
	fi
	# Already claimed. Reclaim only a demonstrably abandoned one.
	if [ -n "$(find "$CLAIMS/$id" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
		printf '%s\n' "$CLAIM_AS" > "$CLAIMS/$id/owner"
		touch "$CLAIMS/$id"
		return 0
	fi
	return 1
}

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
			# A request whose session died is never coming back, and the model server will never read an answer to
			# it. Offering one to a responder wastes a whole turn on a conversation nobody is listening to, and
			# across a batch of projects those corpses accumulate faster than they are answered.
			[ -n "$(find "$path" -mmin +"$STALE_MINUTES" 2>/dev/null)" ] && continue
			if [ -n "$CLAIM_AS" ] && [ -d "$CLAIMS/$id" ] && [ -z "$(find "$CLAIMS/$id" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
				continue   # another responder owns this turn
			fi
			if [ -z "$next" ] || [ "$id" -lt "$next" ]; then next="$id"; fi
		done
	done
	if [ -n "$next" ] && claim_id "$next"; then echo "$next"; exit 0; fi
	[ "$(date +%s)" -ge "$deadline" ] && { echo "NONE"; exit 3; }
	sleep "$POLL"
done
