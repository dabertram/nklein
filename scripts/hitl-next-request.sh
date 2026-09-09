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
# Claiming is ON BY DEFAULT (2026-09-08). It was opt-in, and opt-in safety is not safety: two responders raced this
# queue for an hour because the documented invocation did not pass `--claim`. One of them had been left running from
# an earlier project while a batch responder was started for a new one, and their overlapping id ranges produced
# orphaned answers and a card that took five review rounds because each responder kept undoing the other's fix for
# the same feedback. The mechanism existed and was not used, which is the same as not having it.
#
# A second UNCLAIMED responder is worse than none. The queue is strictly serial — one request in flight — so a
# second answerer adds no throughput, only races: two responders can pick up the same id, and whichever answer
# lands second is discarded work, while a RECORDING of the drive (scripts/hitl-record-project.mts) becomes
# incoherent because the run it replays was produced by two different minds taking alternate turns. Live
# 2026-09-08: a second responder spent a full turn analysing request 613 before noticing the first had already
# answered it. Claiming makes that structural instead of conventional: `mkdir` is atomic, so exactly one caller
# wins each id, and a loser silently moves on to the next unclaimed request rather than duplicating work.
#
# ── TWO CLAIMING RESPONDERS ARE NOW RUN DELIBERATELY (2026-09-09) ──
# Not for throughput — the endpoint really is serial — but for REDUNDANCY. The agent in the model seat has died
# five times: twice to its own harness's no-progress watchdog, once to an API connection error, once silently
# after two requests, once unexplained. Each death idles the whole factory until someone notices, and one such gap
# ran 46 minutes. Two responders mean a death costs a handover, not an outage.
#
# What made the 2026-09-08 incident harmful was the RACE, and claiming removes it structurally. What remains is
# that a card's consecutive turns can land on different responders, so a responder must not rely on its own memory
# of a card — re-read the files and re-run the tests. That instruction is in the brief.
#
# The wait DEFAULT is 240s, not the tool cap. Live 2026-09-08: a responder was killed mid-drive by the agent
# harness's stream watchdog — "no progress for 600s" — while sitting in a healthy 540s blocking wait. The binding
# limit is not the tool timeout, it is how long the agent may go without PRODUCING anything, and a blocking call
# produces nothing until it returns. So the wait must end well inside that window and be re-entered: four minutes
# keeps the turn visibly alive, and re-entering costs one cheap tool call. The rig sat idle behind a dead responder
# for ten minutes before anyone noticed, which is the failure this default exists to prevent.
#
# Usage:  scripts/hitl-next-request.sh <mark> [maxWaitSeconds] [--claim <responderId>]
#   <mark>      answer only ids strictly greater than this (scopes a capture to one project)
#   --claim ID  claim under this responder name (default: `responder-<pid>`; claiming is ON)
#   --no-claim  opt OUT of claiming — only for a deliberately single-responder debugging session
# Env:    HITL_STALE_MINUTES (default 30) — ignore unanswered requests older than this; their sessions are gone.
#         HITL_CLAIM_ABANDONED_MINUTES (default 20) — only for owners whose liveness cannot be read (another
#         machine, or a non-pid name). A `responder-<pid>` owner is judged by liveness alone: dead is reclaimed
#         IMMEDIATELY, and a LIVE owner is never stolen from however long its turn takes.
# Prints:  the lowest unanswered request id > mark, or "NONE" if none appeared before the deadline.
# Exit:    0 when an id is printed, 3 on timeout (so `||` can distinguish "idle" from "error").
set -u
QUEUE="${HITL_QUEUE:-$HOME/.nklein/factory-drains/hitl-drain/queue}"
MARK="${1:-0}"
# Positional-2 is OPTIONAL, so it must be accepted only when it actually looks like a wait. Live 2026-09-09: a
# responder invoked `<mark> --claim <name>` — exactly the form the usage line above permits — and MAX_WAIT became
# the literal string "--claim", which produced a bash arithmetic error on every call and silently corrupted the
# NONE-after-240s deadline. An optional positional followed by flags has to be validated, not assumed.
case "${2:-}" in
	''|*[!0-9]*) MAX_WAIT=240;;
	*) MAX_WAIT="$2";;
esac
POLL="${HITL_POLL_SECONDS:-5}"
STALE_MINUTES="${HITL_STALE_MINUTES:-30}"   # a request older than this with no answer is a corpse, not work
# How long a claim may sit untouched before another responder may take it. This was 60 minutes, and 60 minutes is
# not a safety margin, it is the outage: when a responder died mid-turn (twice on 2026-09-08, killed by the agent
# harness's own 600s no-progress watchdog) its claim wedged the model seat for an HOUR, and the claim had to be
# removed by hand before a replacement could work. A live responder cannot be silent longer than that watchdog
# allows, and a real turn is minutes, so 20 is generous for the living and quick for the dead.
CLAIM_ABANDONED_MINUTES="${HITL_CLAIM_ABANDONED_MINUTES:-20}"
CLAIM_AS="responder-$$"
while [ $# -gt 0 ]; do
	case "$1" in
		--claim) CLAIM_AS="${2:-responder-$$}"; shift 2;;
		--no-claim) CLAIM_AS=""; shift;;
		*) shift;;
	esac
done
CLAIMS="$QUEUE/claims"

# A claim is STALE once the request it guards has an answer, or once nothing has touched it for
# CLAIM_ABANDONED_MINUTES (a responder that died mid-turn must not wedge the seat, which is the very failure the
# claim exists to prevent — see the constant above for why the old hour was self-defeating).
# A claim's owner is `responder-<pid>` on THIS machine, so its liveness is a fact, not a guess: `kill -0` answers
# in microseconds. A claim whose owner process is gone is abandoned NOW — waiting out the age window would be
# choosing to ignore what we can already see. Live 2026-09-09: a responder was stopped mid-request and its claim
# blocked every other responder for the full twenty minutes, idling the factory while two live responders looped
# on NONE. Returns 0 when the owner is definitely gone.
claim_owner_is_dead() {
	local id="$1"
	local owner pid
	owner="$(cat "$CLAIMS/$id/owner" 2>/dev/null)" || return 1
	case "$owner" in
		responder-[0-9]*) pid="${owner##*-}";;
		*) return 1;;   # a non-pid owner name tells us nothing; fall back to the age window
	esac
	kill -0 "$pid" 2>/dev/null && return 1
	return 0
}

# Whether we can READ this claim's owner liveness at all. When we can, liveness decides and the age window is not
# consulted — a live owner keeps its claim however long its turn takes.
claim_owner_liveness_known() {
	local owner
	owner="$(cat "$CLAIMS/$1/owner" 2>/dev/null)" || return 1
	case "$owner" in
		responder-[0-9]*) return 0;;
		*) return 1;;
	esac
}

claim_id() {
	local id="$1"
	[ -z "$CLAIM_AS" ] && return 0
	mkdir -p "$CLAIMS" 2>/dev/null
	if mkdir "$CLAIMS/$id" 2>/dev/null; then
		printf '%s\n' "$CLAIM_AS" > "$CLAIMS/$id/owner"
		return 0
	fi
	# Already claimed. Reclaim only a demonstrably abandoned one.
	#
	# A LIVE owner is never stolen from, however long it has held the claim. Live 2026-09-09: a responder whose
	# method is to verify each mutant in a scratchpad before writing legitimately spends more than the age window
	# on a single turn, and the window let the other responder reclaim and OVERWRITE four of its finished answers.
	# The age fallback exists for the cases where liveness cannot be established — an owner on another machine, or
	# a name that is not `responder-<pid>` — and asking it to also bound a live owner's working time was a guess
	# standing in for a fact we can read directly.
	if claim_owner_is_dead "$id"; then
		printf '%s\n' "$CLAIM_AS" > "$CLAIMS/$id/owner"
		touch "$CLAIMS/$id"
		return 0
	fi
	if ! claim_owner_liveness_known "$id" &&
		[ -n "$(find "$CLAIMS/$id" -maxdepth 0 -mmin +"$CLAIM_ABANDONED_MINUTES" 2>/dev/null)" ]; then
		printf '%s\n' "$CLAIM_AS" > "$CLAIMS/$id/owner"
		touch "$CLAIMS/$id"
		return 0
	fi
	return 1
}

# A claim guards a request that is being ANSWERED. Once the answer exists the claim has done its job, and a
# directory that only ever grows is the shape of a problem that shows up months later on someone else's watch
# (the 2026-09-06 temp-folder sweep started the same way). Prune on entry: cheap, and it needs no cooperation from
# a responder that has already moved on.
if [ -d "$CLAIMS" ]; then
	for claim in "$CLAIMS"/*; do
		[ -d "$claim" ] || continue
		claimed_id="${claim##*/}"
		[ -f "$QUEUE/answers/$claimed_id.json" ] && rm -rf "$claim"
	done
fi

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
			if [ -n "$CLAIM_AS" ] && [ -d "$CLAIMS/$id" ] && ! claim_owner_is_dead "$id" &&
				{ claim_owner_liveness_known "$id" ||
					[ -z "$(find "$CLAIMS/$id" -maxdepth 0 -mmin +"$CLAIM_ABANDONED_MINUTES" 2>/dev/null)" ]; }; then
				continue   # another LIVE responder owns this turn
			fi
			if [ -z "$next" ] || [ "$id" -lt "$next" ]; then next="$id"; fi
		done
	done
	if [ -n "$next" ] && claim_id "$next"; then echo "$next"; exit 0; fi
	[ "$(date +%s)" -ge "$deadline" ] && { echo "NONE"; exit 3; }
	sleep "$POLL"
done
