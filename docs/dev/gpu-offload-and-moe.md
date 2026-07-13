# GPU offload & MoE expert-CPU-offload — a fleet reference

> Maintained reference (2026-07-01 research pass, user-requested). How GPU **offload** and **MoE expert-CPU-offload** work,
> and the **per-machine load policy** they imply for our fleet (m5max · m4mini · davidlegion5pro). Stable empirical
> facts live in the typed model catalog/fitness ledger; `model-lab`/`lms-model-runner` applies this policy. Historical
> time-series evidence was archived during the 2026-07-13 `todo.md`/`done.md` consolidation.

## TL;DR for our fleet

| machine | memory | policy | why |
|---|---|---|---|
| **m5max** (Apple Silicon, 128 GB UMA) | unified | **always `--gpu max`** (full offload); prefer **MLX** builds | UMA = no PCIe copy; leaving layers on CPU only loses throughput. MLX beats llama.cpp 20–87 % <14B. Even a 120B MoE fits + runs fast (gpt-oss-120b PASS @22s). |
| **m4mini** (Apple Silicon) | unified | **always `--gpu max`** | same UMA reasoning; only ≤~9B models live here so they fit trivially. |
| **davidlegion5pro** (RTX 4070M **8 GB VRAM** + Ryzen7 **32 GB RAM**) | split (VRAM ↔ system RAM over PCIe) | **small (≤~8 GB) → `--gpu max`** (fully in VRAM = fast); **medium (12–14B) → `--gpu <ratio>`** partial; **big MoE → expert-offload ideal (see caveat)** | discrete GPU: what's not in VRAM spills to RAM over PCIe. The offload ratio is the lever. |

**The one-line rule:** Apple Silicon → full offload, no exceptions. Discrete GPU (Legion) → keep the always-active weights
(attention/router) on the GPU and push the big sparsely-used MoE expert FFNs to CPU/RAM.

## 1. GPU offload (layer-based) — `--gpu` / `-ngl`

A model is a stack of layers. `--n-gpu-layers`/`-ngl` (llama.cpp) = how many layers sit on the GPU; the rest run on CPU
and activations shuttle across PCIe each token. LM Studio surfaces this as **`lms load <key> --gpu <ratio>`**:

- `--gpu max` = all layers on GPU (≡ `-ngl -1`, "fit as many as VRAM allows").
- `--gpu off` = CPU-only (`-ngl 0`).
- `--gpu 0.5` = ~50 % of layers on GPU (partial offload).

**Partial-offload rule of thumb:** fitting ~20/32 layers ≈ 60–70 % of full-GPU speed — still far above CPU-only. More
layers on GPU = faster, until you OOM the VRAM. On an 8 GB card a 7B-Q4 sweet spot is ~35 layers.

## 2. MoE expert-CPU-offload — the big lever (`--n-cpu-moe` / `--override-tensor`)

A Mixture-of-Experts model activates only a few experts per token (e.g. gpt-oss-120b = 116B total but **5.1B active**;
qwen3.6-35b-**a3b** = 3B active). The expert FFN tensors are **huge but sparsely used**; attention + router + shared
layers are **small but used every token**. So the optimal split is:

> **Always-active weights (attention/router/shared) → GPU. Expert FFN tensors → CPU/RAM.**

llama.cpp does this with:
- **`--n-cpu-moe N`** — keep the expert tensors of the top *N* layers on CPU (counts from the highest-numbered layers).
- **`--override-tensor "\.ffn_.*_exps\.weight=CPU"`** (`-ot`) — regex: pin *all* expert FFN weights to CPU, attention on GPU.

**The clever bit (why it's cheap):** llama.cpp does *not* copy the expert weights into VRAM. It sends the token's small
**activation vector** VRAM→RAM over PCIe, the **CPU** multiplies it against the expert weights already in system RAM, and
sends the small result back. Only tiny activations cross the bus, not gigabytes of weights.

**Payoff (documented):** gpt-oss-120b on an **8 GB GPU + 64 GB RAM ≈ 25 tok/s**; on an RTX 3090, expert-offload lifted
gen from ~3.4 → 8+ tok/s (and ~428 tok/s prompt). Needs **≥64 GB RAM** for the 120B — so on the Legion's 32 GB the 120B
is out, but a **~22 GB A3B (qwen3.6-35b-a3b)** is the interesting borderline candidate.

## 3. LM Studio specifics — and the CLI limitation ⚠️

- **v0.3.39** shipped an Advanced-Configuration toggle **"Force Model Expert Weights onto CPU"** = true *expert-only*
  offload (the good kind above).
- **v0.4.0 replaced it** with a slider that forces **whole layers** to CPU — *less* efficient for MoE (you can no longer
  keep attention on GPU while only the experts go to CPU). Users have filed to restore the toggle (bug-tracker #1419/#1421, Jan 2026).
- **`lms load --gpu <ratio>` (CLI) only exposes the layer-based control**, not expert-only offload. So from our
  `model-lab`/guard path we get **layer-ratio partial offload**; true expert-offload for a big MoE on the Legion needs
  either the **GUI toggle** (if the installed version has it) or a **raw llama.cpp `-ot` invocation**. Recorded as a known
  limitation — our CLI sweeps use `--gpu <ratio>`; expert-offload is a manual/GUI escalation for the big-MoE-on-Legion case.

## 4. Apple Silicon (m5max / m4mini) — always full offload

UMA (unified memory) means CPU + GPU + ANE share one high-bandwidth pool — **no PCIe transfer at all**. "There is no
scenario on Apple Silicon where you want to leave layers on the CPU": `-ngl -1` / `--gpu max` is set-and-forget. Partial
offload is only a last-resort when a model *barely* fits. **MLX** > llama.cpp here for bandwidth-bound inference (never
copies what UMA doesn't require) — 20–87 % higher gen throughput <14B — so **prefer MLX builds on the Macs**. This is why
our guard hardcodes `gpu: "max"` for Local loads, and it's correct.

## 5. Two models on one box: GPU + CPU co-residence (the Legion concurrency idea)

Can the Legion run **one model on its 8 GB GPU AND a second `--gpu off` (CPU-only) model at the same time**, for cheap
extra concurrency? Largely **yes, with one caveat**:

- **Compute is separate** — GPU shader cores vs CPU cores don't contend; the CPU model's slowness doesn't steal GPU FLOPs.
- **Memory bandwidth is the shared resource.** A CPU-only model is *memory-bandwidth-bound* and will saturate **system
  RAM** bandwidth. So the co-residence is contention-light **only if the GPU model is fully in VRAM** (uses separate VRAM
  bandwidth). The moment the GPU model **spills to system RAM** (partial offload or KV-cache-in-RAM), the two fight over
  the same RAM bus and both slow down.
- **Practical policy:** pair a **fully-in-VRAM** GPU model (≤~8 GB, `--gpu max`) with **one** CPU-only model
  (`--gpu off`) — the user's intuition holds. Don't stack a partial-offload GPU model with a CPU model. This is a
  per-machine-pool lever (see the per-machine concurrency work), to validate empirically before relying on it.

## 6. Applied: our per-machine load policy (what the guard/sweeps use)

- **m5max / m4mini:** `--gpu max` always (guard default). Prefer MLX.
- **Legion small (coder-7b, qwen3-8b, qwen3.5-9b): `--gpu max`** — fits in 8 GB VRAM, fast.
- **Legion medium (gemma-4-12b ~7 GB, qwen3-14b ~9 GB): `--gpu <ratio>`** tuned by `lms load … --estimate-only` first
  (the device-aware, no-load fit check — the correct cross-machine safety gate, since host-side headroom math doesn't
  know a remote box's RAM).
- **Legion big MoE (qwen3.6-27b 17 GB, qwen3.6-35b-a3b 22 GB):** estimate-only first; layer-ratio `--gpu` low + reduced
  context if safe, else **defer to expert-offload** (GUI toggle / raw `-ot`). The **A3B** is the best big-MoE candidate
  for the 32 GB box.
- Always: `--estimate-only` before a real remote load; device-scoped unload (never evict another machine's model).

## Sources

- [llama.cpp #20757 — two-tier GPU+RAM expert cache for MoE offload](https://github.com/ggml-org/llama.cpp/issues/20757)
- [HuggingFace — Performant local MoE CPU inference with GPU acceleration in llama.cpp](https://huggingface.co/blog/Doctor-Shotgun/llamacpp-moe-offload-guide)
- [DocShotgun — Guide to optimizing large MoE across CPU+GPU in llama.cpp](https://gist.github.com/DocShotgun/a02a4c0c0a57e43ff4f038b46ca66ae0)
- [knightli — RTX 3060 12GB + `--n-cpu-moe` for Qwen MoE 35B](https://knightli.com/en/2026/05/26/rtx-3060-llama-cpp-n-cpu-moe-local-35b/)
- [Medium (Sanftenberg) — offloading Qwen3-235B-A22B in llama.cpp](https://medium.com/@david.sanftenberg/gpu-poor-how-to-configure-offloading-for-the-qwen-3-235b-a22b-moe-model-using-llama-cpp-13dc15287bed)
- [Hardware Corner — GPT-OSS-120B: offloading MoE layers to CPU](https://www.hardware-corner.net/gpt-oss-offloading-moe-layers/)
- [carteakey.dev — optimizing gpt-oss-120b on consumer hardware](https://carteakey.dev/blog/local-inference/optimizing-gpt-oss-120b-local-inference/)
- [LM Studio bug-tracker #1421 — restore "Force Model Expert Weights onto CPU" toggle](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1421)
- [LM Studio docs — `lms load`](https://lmstudio.ai/docs/cli/local-models/load)
- [Markaicode — LM Studio GPU layers / VRAM optimization](https://markaicode.com/lm-studio-gpu-layers-vram-optimization/)
- [Medium (Hannecke) — tuning llama.cpp on Apple Silicon](https://medium.com/@michael.hannecke/tuning-llama-cpp-on-apple-silicon-843f37a6c3dc)
- [Groundy — MLX vs llama.cpp on Apple Silicon](https://groundy.com/articles/mlx-vs-llamacpp-on-apple-silicon-which-runtime-to-use-for-local-llm-inference/)
