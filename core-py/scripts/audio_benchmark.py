"""Audio-VST DSP benchmark for the !Klein native Python agent core.

Scaffolds a real, buildable C++ project (cmake + clang; no JUCE download needed for the first iteration, but
the same structure extends to a JUCE plugin) with a kick-synth stub and a DSP acceptance test, then drives the
native agent core (read/write/edit/list/run_command) on qwen3.5 to implement the DSP until `cmake build &&
./kick_test` passes. Observes the run (per-turn log) and reports the classified outcome.

Run: ``uv run python scripts/audio_benchmark.py --max-turns 40``
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from klein_core.agent_loop import make_model_decider, run_agent_loop
from klein_core.agent_tools import WorkspaceTools
from klein_core.generation import ProxyBackend

MODEL = "lmstudio-community/qwen3.5-9b-mlx-8bit-m4-32kctx"
BASE_URL = "http://127.0.0.1:1234/v1"

CMAKELISTS = """cmake_minimum_required(VERSION 3.16)
project(klein_kick LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
add_executable(kick_test src/kick_synth.cpp test/kick_test.cpp)
target_include_directories(kick_test PRIVATE src)
"""

HEADER = """#pragma once
#include <vector>
// Render a psytrance kick: a sine whose pitch sweeps from startHz down to endHz over the note, with a
// percussive amplitude envelope (fast attack, exponential decay). Return `numSamples` mono samples in [-1, 1].
std::vector<float> renderKick(double sampleRate, int numSamples,
                              double startHz, double endHz, double decaySeconds);
"""

STUB = """#include "kick_synth.h"
// TODO(agent): implement renderKick. Currently returns silence, so the test fails.
std::vector<float> renderKick(double sampleRate, int numSamples,
                              double startHz, double endHz, double decaySeconds) {
    (void)sampleRate; (void)startHz; (void)endHz; (void)decaySeconds;
    return std::vector<float>(numSamples, 0.0f);
}
"""

TEST = """#include "kick_synth.h"
#include <cmath>
#include <cstdio>
int main() {
    const double sr = 48000.0;
    const int n = (int)(sr * 0.4);
    auto buf = renderKick(sr, n, 120.0, 45.0, 0.25);
    if ((int)buf.size() != n) { printf("FAIL size\\n"); return 1; }
    // Non-silent and within range.
    float peak = 0.f; for (float s : buf) { if (std::fabs(s) > peak) peak = std::fabs(s); }
    if (peak < 0.1f || peak > 1.0001f) { printf("FAIL peak %f\\n", peak); return 1; }
    // Percussive decay: the first eighth is louder than the last eighth.
    auto rms = [&](int a, int b){ double s=0; for (int i=a;i<b;i++) s+=buf[i]*buf[i]; return std::sqrt(s/(b-a)); };
    double head = rms(0, n/8), tail = rms(7*n/8, n);
    if (!(head > tail * 2.0)) { printf("FAIL envelope head %f tail %f\\n", head, tail); return 1; }
    printf("PASS peak=%f head=%f tail=%f\\n", peak, head, tail);
    return 0;
}
"""

ACCEPTANCE = "cmake -S . -B build -DCMAKE_BUILD_TYPE=Release >/dev/null 2>&1 && cmake --build build >/dev/null 2>&1 && ./build/kick_test"

TASK = (
    "Implement a psytrance kick synthesizer in C++ so the acceptance test passes.\n"
    "Edit src/kick_synth.cpp to implement renderKick (see src/kick_synth.h): a sine oscillator whose pitch "
    "sweeps from startHz down to endHz across the note, with a fast-attack exponential-decay amplitude "
    "envelope (use decaySeconds), output mono samples in [-1,1].\n"
    "Build and run the test with run_command using exactly:\n"
    f"  {ACCEPTANCE}\n"
    "Iterate until the command exits 0 and prints PASS, then finish. Use edit_file for changes; read files first."
)


def scaffold(root: Path) -> None:
    (root / "src").mkdir(parents=True)
    (root / "test").mkdir(parents=True)
    (root / "CMakeLists.txt").write_text(CMAKELISTS)
    (root / "src" / "kick_synth.h").write_text(HEADER)
    (root / "src" / "kick_synth.cpp").write_text(STUB)
    (root / "test" / "kick_test.cpp").write_text(TEST)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-turns", type=int, default=40)
    parser.add_argument("--log", default=None)
    args = parser.parse_args()

    root = Path(tempfile.mkdtemp(prefix="klein-audio-bench-"))
    scaffold(root)
    log_path = Path(args.log) if args.log else root / "benchmark.log"

    def log(line: str) -> None:
        stamped = f"[{time.strftime('%H:%M:%S')}] {line}"
        print(stamped, flush=True)
        with log_path.open("a") as handle:
            handle.write(stamped + "\n")

    log(f"workspace: {root}")
    log(f"acceptance: {ACCEPTANCE}")
    backend = ProxyBackend(base_url=BASE_URL)
    tools = WorkspaceTools(str(root), allow_commands=True, command_timeout_s=300).build()
    base_decider = make_model_decider(backend, MODEL)

    turn_counter = {"n": 0}

    async def observing_decider(task, tool_list, transcript):  # type: ignore[no-untyped-def]
        turn_counter["n"] += 1
        if transcript:
            last = transcript[-1]
            obs = (last.observation or "")[:160].replace("\n", " ")
            log(f"turn {last.turn}: {last.action.get('action')} -> {obs}")
        return await base_decider(task, tool_list, transcript)

    started = time.time()
    result = await run_agent_loop(TASK, tools, observing_decider, max_turns=args.max_turns)
    elapsed = time.time() - started

    # Final acceptance check (ground truth, independent of the agent's claim).
    proc = subprocess.run(ACCEPTANCE, shell=True, cwd=str(root), capture_output=True, text=True, timeout=300)
    acceptance_passed = proc.returncode == 0
    log(f"RESULT status={result.status} turns={result.turns} elapsed={elapsed:.0f}s")
    log(f"ACCEPTANCE passed={acceptance_passed} :: {(proc.stdout + proc.stderr).strip()[:200]}")
    log(f"final kick_synth.cpp:\n{(root / 'src' / 'kick_synth.cpp').read_text()[:1500]}")
    summary = {
        "status": result.status,
        "turns": result.turns,
        "elapsed_s": round(elapsed),
        "acceptance_passed": acceptance_passed,
        "workspace": str(root),
    }
    log("SUMMARY " + json.dumps(summary))
    if not shutil.which("cmake"):
        log("WARN cmake not found")


if __name__ == "__main__":
    asyncio.run(main())
