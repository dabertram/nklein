# Running the full SWE-bench suite through !Klein

*P1.SWEBENCHFULL, 2026-09-15.* The N8 tranche (`docs/benchmarks/swebench-tranche-2026-09.md`) grades ten
hand-proven instances. This is the path to Lite (300), Verified (500) and the full test split (2,294): every step
that touches the network is an explicit operator command, everything after it is hermetic, and every receipt
names the environment it was graded in.

## The pipeline

| step | command | network | what it produces |
|---|---|---|---|
| 1. spec table | `tsx scripts/swebench-specs.mts fetch` | ⚠ once | `.nklein-bench/swebench/specs.json` — upstream `MAP_REPO_VERSION_TO_SPECS` (python, pre_install, packages, install, pip_packages, test_cmd per repo+version) with the package version and sha256 it came from |
| 2. index | `tsx scripts/swebench-fetch.mts index --all --datasets=lite,verified` | ⚠ once per dataset | `index.json` + `staging/<id>.json` (no gold patch, ever) |
| 3. mirrors | `tsx scripts/swebench-fetch.mts mirror --from-index` | ⚠ once per repo | one bare `git clone --mirror` per repo under `mirrors/` |
| 4. materialize | `tsx scripts/swebench-fetch.mts materialize <id…>` | none once mirrored | `repos/<id>.tar.gz` archived from the mirror, sha-pinned in `pins.json`, `instances/<id>.json` |
| 5. env images | `tsx scripts/swebench-grade.mts build-env <id…>` | ⚠ once per image | `nklein/swebench-base:<python>` (slim + C toolchain) or `nklein/swebench-env:<repo>__<version>` when the spec has pre-install shell |
| 6. wheel caches | `tsx scripts/swebench-grade.mts prepare <id…>` | ⚠ once per instance | `wheels/<id>/` — the repo's closure, the spec's packages/pins, the offline build toolchain |
| 7. control | `tsx scripts/swebench-grade.mts control <id>` | none | the UNFIXED workspace must grade unresolved — proves the env before any model runs |
| 8. run | `run.sh` / `scripts/swebench-tranche-run.mts --instances dataset:verified --parallel 4 …` | none (sandbox egress per the arm's allowlist) | receipts, `summary.*` |

`resolveSwebenchEnv` picks the environment for an instance: a hand-proven `SWEBENCH_TRANCHE` entry wins (its facts
were probed on the sealed grader), else the spec row for (repo, version), else a named refusal. The grader runs the
spec's `test_cmd` with the runner's own selection shape (pytest node ids; django dotted labels; sympy test files
from the test patch) and reads the runner's own output (pytest `-rA` PASSED lines; django `… ok`; sympy `test_x
ok`); a test missing from the output is a failure, never a pass.

## What is approximated, and how it is checked

- **conda specs by pip.** Upstream installs several repos (astropy, matplotlib, xarray, scikit-learn…) from a conda
  `environment.yml`; the grader reads that file into pip pins (`parseCondaEnvironmentYml`) and builds from source
  where no aarch64 wheel exists. The negative control (step 7) is the proof per instance — an env that cannot even
  run the unfixed tests is caught there, not in a model's score.
- **`pre_install` is split.** Upstream runs every pre_install line inside the checkout; here the system lines (apt
  packages, locales, tarballs to /tmp) go into the env image built once per spec, and the repo lines (`sed -i` on
  pyproject/setup files, anything under `/testbed`) run in the instance's own workspace right before its install,
  with `/testbed` rewritten to the sealed workspace path. A spec whose pre_install is repo-only grades on the plain
  base image.
- **Internet-bound graded tests** are declared per instance (`sealedFailToPassExclusions`, with cause) and named on
  the receipt; an instance whose gradable set would empty stays "not resolvable" (finding 7 of the campaign doc).
- **Parallel runs** (`--parallel N`) need the arm HOME's `maxConcurrentTasks ≥ N` and a seat that answers
  concurrently (the Claude responders do; local LM Studio hosts serve one request at a time).
- **The agent's own toolchain** resolves from the same wheels the grader installs: `prepare` flattens every cached
  wheel into `wheels/_flat`, and an arm launcher that finds that directory exports `NKLEIN_AGENT_SANDBOX_WHEELHOUSE`
  — the runtime mounts it read-only at `/opt/nklein/wheelhouse` and points `UV_FIND_LINKS` / `PIP_FIND_LINKS` at it.
  Anything not in the wheelhouse still goes through the arm's egress allowlist (`ecosystem:python`).

## What the bring-up found (2026-09-15/16)

Standing up the 500-instance Verified run surfaced forty-three defects — every one caught by RUNNING the pipeline, none by
reading it. Listed in the order they bit, with the commit that closed each:

| # | symptom | root cause | fix |
|---|---|---|---|
| 1 | `apt-get` exit 100 building python 3.5/3.6 images | those interpreters ride ARCHIVED Debian releases | archive.debian.org fallback, security/-updates suites dropped (`7d303eb5d`) |
| 2 | astropy: `setup.py egg_info` failed | modern setuptools cannot build an era repo; upstream's `packages` pin is a BUILD prerequisite | install the spec's build pins first, `--no-build-isolation` (`ab2ed116a`) |
| 3 | django locale tests would have failed | upstream `eval_commands` (locale-gen, LANG exports) were ignored | run them in the grade shell before the selections (`ab2ed116a`) |
| 4 | ten django/pylint specs: "Could not open requirements file" | `packages: "requirements.txt"` is upstream's SENTINEL for a per-repo path | port `MAP_REPO_TO_REQS_PATHS` to the local checkout, follow `-r`, drop `-e .` (`ab2ed116a`) |
| 5 | a failed prepare's empty dir read as "cached" | the wheel dir is created before the download | a hit needs wheels; a completion marker written only after the fatal repo stage (`7e7c31565`, `bfee649f5`) |
| 6 | ten sphinx specs: `ResolutionImpossible` | one `pip download` resolved stages upstream never resolves together | one download per stage into the same dir (`7e7c31565`) |
| 7 | astropy 4.3: `No module named 'extension_helpers'` | building without isolation also stops pip fetching `build-system.requires` | read PEP 518 requires from the checkout and install them (`ebff622b5`) |
| 8 | django control died with ENOENT mid-copy | the root commit tripped git's `gc --auto`; a concurrent copy raced loose objects into a packfile | `gc.auto=0` in every materialized workspace (`b5ee5427f`) |
| 9 | every sympy selection: "command not found" | its `test_cmd` is an env-var PREFIX and we quoted it as argv tokens | the spec's `test_cmd` stays a shell string; only selections are quoted (`d31e68e45` area) |
| 10 | pytest: `No module named '_pytest._version'` | a tarball checkout has no tags, so setuptools-scm never wrote the version file | `SETUPTOOLS_SCM_PRETEND_VERSION` from the instance's own version (`d31e68e45`) |
| 11 | every matplotlib env image: `mkdir -p ""` | the pre_install split stranded a shell assignment from its use | the split keeps the block contiguous; bases carry wget/curl (`ffa47793c`) |
| 12 | astropy 4.3: `initialization of 'PyCelprm *' from incompatible pointer type` | our bases are Debian 13 / GCC 14.2; upstream's are Ubuntu 22.04 / GCC 11, and GCC 14 promoted six legacy C diagnostics to hard errors | append `-Wno-error=` for each to `CFLAGS` (`d2a52c672`) |
| 13 | astropy 4.3: `cc1: fatal error: astropy/table/_np_utils.c: No such file` | the sealed GRADE never installed the checkout's PEP 518 requires — only the prepare download did — so `cython==0.29.22` was absent and the generated C source was never written | the grade path reads the same requires from the workspace and installs them (`d2a52c672`) |
| 14 | astropy 5.1: every one of 322 pass-to-pass tests failed with `numpy.core.multiarray failed to import` | we build with --no-build-isolation, so `build-system.requires` installs into the RUNTIME venv: `oldest-supported-numpy` pulled numpy down to 1.19.3, the editable install then jumped to 2.0.2, and pyerfa is compiled for the numpy 1.x ABI | re-assert the spec's exact pins with --no-deps after the editable install (`b03e150ea`) |
| 15 | the same suite then printed `322 passed` and still scored 0 | pytest colourises when a plugin forces it, and `\x1b[32mPASSED\x1b[0m` never matches `^PASSED` | every parser strips ANSI escapes first (`b03e150ea`) |
| 16 | three scikit-learn specs: "No matching distribution found for numpy", while `prepare` said "already cached" | the completion marker was written whenever the fatal repo stage passed, so a non-fatal stage that could not resolve (`scipy==1.5.2` has no aarch64/cp36 wheel) left a permanently short cache | the marker is gated on every stage closing; the driver throws and names the stages (`4604f8a75`) |
| 17 | fifteen sphinx specs: editable install died on "No matching distribution found for pytest" | the spec installs `-e .[test]` and the prepare downloaded a bare `/src`, so the extra's requirements never entered the closure | the repo download targets what the install command names (`ad7e889fd`) |
| 18 | sphinx: tox ran `.tox/py39`'s empty interpreter | `tox --current-env` is INERT on tox 4.16 — tox-current-env 0.0.11 still registers the flag but tox builds the venv anyway | rewrite that one flag to `--runner current-env` (`ad7e889fd`) |
| 19 | sphinx: collection aborted with `No module named 'pkg_resources'` | setuptools 82 removed it, and tox's `usedevelop = True` runs its OWN `pip install -e .` inside the graded env, so a pin could not hold | an era constraints file exported as PIP_CONSTRAINT, honoured by nested pip and applied to the download too (`ad7e889fd`) |
| 20 | six matplotlib specs: `metadata-generation-failed` | matplotlib's setup.py resolves `setup_requires` by spawning `pip wheel`, which carried none of our offline flags and reached for PyPI under `--network none` | export PIP_NO_INDEX and PIP_FIND_LINKS so nested pip reads the same cache (`ad7e889fd`) |
| 21 | matplotlib 3.6: `setup_requires` packages absent from the cache | setuptools resolves `setup_requires` at build time via its own `pip wheel`, so `pip download /src` never sees them | the prepare reads the literal list and downloads it as its own stage (`64f7067a3`) |
| 22 | matplotlib 3.7: `ModuleNotFoundError: No module named 'mesonpy'` while downloading | --no-build-isolation was forced on EVERY download stage, so an sdist could not fetch its own PEP 517 backend | the flag is for the repo stage alone; the prepare has network for the rest (`7ab52c4c5`) |
| 23 | matplotlib 3.7: `ResolutionImpossible` — `pandas==3.0.5` against `numpy==1.25.2` | upstream's package lists are conda environments whose entries mostly carry no version, and pip resolves those to TODAY's releases | the spec's own exact pins constrain every resolution, download included — which is what conda did for upstream (`7ab52c4c5`) |
| 24 | matplotlib 3.7: `Failed to download qhull-2020-src-8.0.2.tgz` and the same for freetype | a repo's build fetches sources OUTSIDE pip: a pre_install wget into `build/`, and an XDG-cached freetype during `build_ext`. Both work while preparing and cannot work under `--network none` | the prepare's probe warms both and every grade replays them (`7ab52c4c5`) |
| 25 | one unavailable pin killed a whole stage (conda-only `pyqt`, `pygobject`, `wxpython`, `gtk4`) | the stage resolved as a unit, so `numpy` was lost along with the GUI toolkit beside it | non-fatal stages retry pin by pin, record what cannot resolve here, and the grade drops exactly those and NAMES them in the verdict (`7ab52c4c5`) |
| 26 | django 3.0/3.2: `No matching distribution found for bcrypt` for a wheel sitting in the cache | `python -m venv` seeds the interpreter's OWN bundled pip — pip 18.1 on the python 3.6 image — which predates PEP 600 and cannot read a `manylinux_2_28` or abi3 tag | upgrade the venv's pip from the cache before anything else resolves (`99312822f`) |
| 27 | sphinx and scikit-learn: ResolutionImpossible after the matplotlib fix | making the spec's pins a GLOBAL constraint contradicts the spec itself — sphinx pins `Jinja2==3.0.3` while its own pre_install rewrites setup.py to `Jinja2<3.0`, which upstream satisfies by installing in sequence | the pins constrain the PACKAGE stages only, via `-c` (`99312822f`, `89a9bbbbb`) |
| 28 | sphinx: `install_requires` rejected as an invalid specifier | the probe re-ran a repo pre_install the download had already applied to the same tree, and those `sed` lines are not idempotent | the probe skips it; the grade still runs it on its fresh copy (`265a5b0d1`) |
| 29 | matplotlib 3.5/3.6: packages stage lost numpy | `wxpython` downloads as an sdist and then compiles wxWidgets, needing GTK development libraries — a pin can download and still fail to build | the probe reads `Failed building wheel for X` and records it; pip's own "(from versions: none)" vs a non-empty list separates absent from unusable (`3163aa397`, `c1df40b2b`) |
| 30 | matplotlib 3.0: `cc1: error: '-Wno-error=return-mismatch': no option '-Wreturn-mismatch'` | an OLD gcc treats an unknown `-Wno-error=` as a hard ERROR, and the images span GCC 8 to GCC 14.2 | each flag is probed against the image's own compiler; only supported ones are exported (`fba9abf25`) |
| 31 | scikit-learn 0.20–1.3: `NotFoundError: No lapack/blas resources found` | upstream's environments are conda, which ships BLAS/LAPACK as packages; a `python:X-slim` image ships none | the base layer installs gfortran, OpenBLAS, LAPACK, freetype, png and zlib, best-effort per package on archived suites (`c1df40b2b`) |
| 32 | scipy 1.5.2's build env: `numpy==1.14.5` reported missing while numpy 1.19.x sat in the cache | the probe read any non-empty candidate list as "present but unusable", so it never fetched the pinned version | an exact `==` pin whose version is absent from the candidates counts as MISSING; only a discarded-candidates failure counts as unusable (`e3b14cbc8`) |
| 33 | matplotlib 3.5: the packages stage lost numpy to a documentation-extras conflict | upstream's conda lists carry doc extras (`numpydoc`, `sphinx`, `sphinx-panels`) that cannot coexist under pip, and the stage resolved as a unit | install as a unit, then pin by pin; a pin that fails alone is named, recorded, and dropped by the grade (`e3b14cbc8`) |
| 34 | django 1.11: `fatal error: ffi.h`; django 2.2: `libmemcached/memcached.h` | more system libraries conda gave upstream | libffi, libssl, libxml2, libxslt, libjpeg and libmemcached join the base image; the requirements FILE install also falls back line by line (`e3b14cbc8`, `ee6ff5307`) |
| 35 | scikit-learn 0.20: the build stopped at `[ 1/39] Cythonizing …` with no message | Cython 3.0 rejects language constructs 2018-era `.pyx` files use, and the spec pins `cython` with no version | "died while Cythonizing" is treated as the evidence: fetch `Cython<3`, record it as a build requirement, retry once (`a99a32ad8`) |
| 36 | scikit-learn 1.3: `no such option: --no-use-pep517`, then `missing the 'build_editable' hook` | the flag was removed in pip 23.1 and is load-bearing — the spec's `setuptools<60.0` backend predates PEP 660 | the flag's presence selects the pip era: `pip<23.1` for those specs, newest for everything else (`ee6ff5307`) |
| 37 | django: `unittest.loader._FailedTest` for half the selections | unittest prints a test's DOCSTRING instead of its id when it has one, and the dataset records whichever was printed — so half of django's ids are English sentences | run the test MODULES the patch touches, as upstream does, and credit every id form a passing line could be (`34deffbdc`) |
| 38 | sphinx 3.2: tox aborted with exit 128 before any test | its tox.ini lists a `git+https://…` dependency and a sealed grade cannot clone | the URL is rewritten to the project name so pip resolves it from the cache (`8debd8844`) |
| 39 | five sphinx specs: `No module named 'roman'` at collection | a RUNTIME import nothing declares — the closure probe proves an install, and this only appears when tests are collected | the control records it beside the wheels and clears the marker; the next prepare pulls it in and the grade installs it (`8debd8844`) |
| 40 | pylint 3.0: `module 'astroid.nodes' has no attribute 'Try'` | the pin re-assertion restored the spec's older astroid over the newer one the REPO's own install had chosen | who moved the pin decides: our build-requirements stage → restore; the repo's editable install → leave it (`5c7705324`) |
| 41 | pylint 3.0: a perfectly good pin recorded as unavailable | pip strips a requirements file's inline comments and does NOT strip them from an argument, and the per-line fallback passes arguments | comments are stripped where the file is flattened and again in the fallback (`5c7705324`) |
| 42 | requests 2.0: 35 of 79 pass-to-pass tests lost to `requests.exceptions` | the era suites read `HTTPBIN_URL` and fall back to the real httpbin.org, which a sealed grade cannot reach | detect that variable, put `httpbin` in the closure, serve it on loopback inside the sealed namespace (`39e0ff997`) |
| 43 | xarray 2022.06: `Pandas requires version '0.19.0' or newer of 'xarray' (version '0.0.0' …)` | `requires = [...]` was matched lazily to the FIRST `]`, and `"setuptools_scm[toml]>=3.4"` closes it mid-string — so setuptools_scm never entered the closure and the build had no version source | scan the array by bracket DEPTH, skipping quoted text (`cf5962d66`) |
| 44 | astropy 13398: a PRISTINE tree scored 0 of 68 pass-to-pass tests, and its receipt blamed the model | the closure is keyed per `(repo, version)` spec, but build requirements move between base commits INSIDE a spec — `astropy__astropy__5.0` was probed from instance 13236 (`cython==0.29.22`) while 13398 declares `cython==0.29.30`, so the sealed install could not resolve it, `extension_helpers` never installed, and pytest aborted parsing `setup.cfg` with `No module named 'astropy'` | `prepare` unions EVERY sibling instance's build requirements into the cache — download-side only, because astropy 5.0 needs both cython pins cached and asking pip for both in one install is unsatisfiable |
| 45 | the same grade reported a score at all | the grade script is `set -u`, not `set -e`: it emitted `SWEBENCH_PIP_FAILED` twice and ran pytest anyway, and the receipt keeps a 1200-char TAIL, so the marker on line 1 was truncated out of the evidence | a failed install is a REFUSAL — `swebenchEnvironmentRefusal` names the stages, the runner excludes the instance from the score, and the closure-recording path is barred (it would have learned `astropy` as a missing runtime requirement and sealed real tests as pristine failures) |
| 46 | xarray 0.12: 24 of 1717 pass-to-pass tests, and the "log" was the grade script itself | the script is passed as ONE argv to `bash -lc`, and Linux caps a single argument at 128 kB (`MAX_ARG_STRLEN`) — 1717 embedded ids make it ~153 kB, so the container died with `exec /usr/bin/bash: argument list too long` before running a line | the script is written into the mounted workspace and run from there; a docker failure can no longer wear a score's clothes |
| 47 | the same grade was then REFUSED with the stage list `build-requirements",editable",pins-reassert";,…` | when docker exits nonzero the caller substitutes the error message, which quotes the whole script, and every `\|\| echo "SWEBENCH_PIP_FAILED <stage>"` in that source read as a failure that happened | the marker is anchored to a whole line — the real one is echoed alone, the source copies never are |
| 48 | sklearn 1.3: four `test__wrap_in_pandas_container_*` tests sealed as "fails in the pristine control" | they skip with `could not import 'pandas'` — a phrasing the recorder's `requires <pkg>` pattern missed — and the SAME pass both failed to record the package and sealed the tests, so a fixable closure gap was filed as an unexplainable one | the second skip signature is recognised, AND sealing is barred in any run that discovered a missing requirement: the environment is known-incomplete at that moment, so the next control is the one entitled to judge. 47 premature seals across six specs cleared for re-proof; pylint 2.14's seven stay, their cause being documented rather than missing |
| 49 | sklearn 1.3: four tests skipped for `pandas` even after pandas was installed | a recorded runtime requirement went in with `--no-deps`, so `pytz` and `dateutil` never arrived; resolving them freely instead moved numpy and killed the compiled extension (`numpy.core.multiarray failed to import`, 14 tests to 0); filling in only what `pip check` named missing then got pandas 2.3.3, which imports as `C extension: None not built` against the spec's numpy 1.19.3 | the constraint is the ENVIRONMENT ITSELF: `pip freeze` a line earlier, passed as a constraints file. pip must pick a version that fits what is already installed and cannot move any of it; where the closure holds no such version the stage fails loudly, which beats a package that imports as None |
| 50 | pylint 2.15: 105 of 122 tests dead with `UnknownMessageError: No such message id or symbol 'c-extension-no-member'` — and pylint 2.14 had carried SEVEN of the same, sealed as "root cause unexplained", since the first sweep | PEP 660's editable install does not put the source directory on sys.path; setuptools registers a MetaPathFinder shim. pylint's `register_plugins` walks its checkers directory and resolves each file back through sys.path, printing `Unable to find module for /work/pylint/checkers/typecheck.py in …` to stderr — seven checkers never registered, and the repo's own pylintrc then named a message nothing had defined | `--config-settings editable_mode=compat` restores the legacy `.pth` layout, which puts the checkout on sys.path — the behaviour upstream's era-pinned images produced. **13/122 → 122/122, and pylint 2.14's seven seals retired at 7/7** |
| 51 | the same instance could not be installed at all: `uses a build backend that is missing the 'build_editable' hook` | `pylint-dev__pylint-7277` pins `setuptools~=62.6`, which predates PEP 660 — and because every install runs `--no-build-isolation`, honouring the pin downgrades the venv's setuptools out from under the editable install. Its spec sibling declares no build requirements at all. `--no-use-pep517` is no answer: pylint is pyproject-only, so pip replies `Disabling PEP 517 processing is invalid: project does not have a setup.py` | the cap is DROPPED, and only where nothing else can save the install — a spec already carrying `--no-use-pep517` (scikit-learn 1.3's `setuptools<60.0`) keeps its cap and its proven behaviour, the legacy path needing no hook |
| 52 | xarray 2022.06: 945 pass-to-pass tests down to 18, by our own hand | the recorder reads a name out of a pytest skip and assumes it is a distribution name. xarray's `requires iris` means SciTools Iris; PyPI's `iris` is a placeholder whose import raises `RuntimeError: Ambiguous 'iris' package`, which poisoned `xarray/tests/conftest.py` — and the next control would have recorded the wreckage as fresh evidence | a control whose ENTIRE selection collapsed convicts any recorded name appearing in the import or collection error, records it in `SWEBENCH_REJECTED_RUNTIME.txt` with the line that convicted it, and learns nothing else from that run. **18/945 → 945/945** |
| 53 | astropy 13398: exactly ONE pass-to-pass test failed per run, and WHICH one moved every time | `Time` runs its leap-second check once per process and warns when the update fails; astropy's own setup.cfg sets `filterwarnings = error`, so whichever test touched time first died inside `iers.py`'s bare `except Exception: pass` with `TypeError: unsupported operand type(s) for -: 'Time' and 'float'`. An id that changes every run cannot be sealed, only removed | a pytest plugin (via `PYTEST_PLUGINS`, which does not depend on astropy's HOME/XDG config discovery — writing `astropy.cfg` did nothing) sets `auto_download = False` and consumes the check quietly before collection. Removes OUR artefact — a 2026 clock with no network — without changing what any test does. **0/68 → 68/68** |
| 54 | a seal that said "fails in the pristine control" when the dataset was responsible | a negative control assumes every pass-to-pass test passes without the fix, and the instance's own test patch can break that premise by rewriting one onto the feature being added — astropy 13398's patch passes `location=` to ITRS, so a pristine tree answers `Coordinate frame ITRS got unexpected keywords: ['location']` | `swebenchTestsRewrittenByPatch` matches ADDED patch lines against the test's own name — never merely sharing a file — so the receipt distinguishes the dataset's doing from an environment defect |
| 55 | scikit-learn's four specs graded in an environment that was quietly not the spec's | upstream quotes its version specifiers (`"pandas<2.0.0"`) and we handed the quotes to pip, so every VERSIONED pin was dropped as "unresolved on this platform" while the bare names installed | strip the quotes before the spec's packages reach pip |
| 56 | astropy 3.1: 7 of 11 pristine pass-to-pass tests scored as errors, `PytestRemovedIn8Warning: Support for nose tests is deprecated` | the closure had correctly recorded `pytest<7.2` (its tests use nose-style `setup()`), but the runtime stage froze the WHOLE environment as constraints — `pytest==7.4.0` included — so the one instruction to move pytest was unsatisfiable by construction; and a failed runtime stage was not a refusal, so it scored | the freeze lifts for exactly the packages a recorded requirement names; a failed runtime-requirements stage now refuses the grade. **4/11 → 11/11** |
| 57 | astropy 5.1: the FIRST graded instance of the Haiku run excluded from the score, for a patch touching one library file | one failed editable install made `import astropy` fail, so the recorder wrote **astropy itself** as a missing runtime requirement; every later grade then asked pip for it offline and failed the runtime stage, which is now a refusal — all 21 instances of the spec would have been excluded for the life of the cache | `isRepoUnderTest` bars the repo's own name from being recorded AND filters it on read, so an infected cache heals with no re-prepare |
| 58 | pytest 5.4: 42 of 58 pass-to-pass tests "REGRESSED" on a pristine tree | `--collect-only -q` printed nothing for the file, so the intersection's fallback ran all 58 ids — and pytest answers ONE unfindable id (`test_valid_idents[:::]`) with `ERROR: not found` and then runs NOTHING | the run corrects itself from what pytest said: drop exactly the ids it could not find, name them, re-run once. **42 → 2**, and those 2 are sealed with the cause (the dataset's id comes from a different pytest id-generation) |
| 59 | two astropy instances excluded as "environment refused" while the same workspace re-graded clean on its own | **Docker Desktop had 7.75 GiB of a 128 GB host**, and four parallel C builds OOM-killed gcc — so a starved daemon read as a broken environment. Four leaked `swebench-base` containers had also been idle for 3 hours holding memory | Docker raised to 31.29 GiB; leaked containers reclaimed. An arm that grades heavy-build specs in parallel needs the daemon's budget checked FIRST — it is not visible in any log the grader writes |
| 60 | astropy 3.1: 80 pass-to-pass tests "regressed" on one delivery, every one `ERROR … PyparsingDeprecationWarning: 'enablePackrat' deprecated` | era drift the spec never pinned — astropy 3.1 (2018) calls `pyparsing.enablePackrat()`, the closure holds pyparsing 3.3.2 (pulled in as a matplotlib dep during the EDITABLE install), and astropy's own `filterwarnings = error` turns the deprecation into an import-time error, so the whole file errors at collection | `pyparsing<3` recorded + the 2.4.7 wheel fetched, but a control still shows 80 — the downgrade is not taking effect and WHY is unresolved (`-q` hides the runtime stage's output, so its absence from the log is not proof it did not run). The instance itself is unaffected: its fail-to-pass fails regardless, so the verdict and the score do not move. **OPEN — needs a container probe of the installed pyparsing version after the install lines** |

The pattern worth keeping: **the negative control is what proves an environment**, and EVERY "pass-to-pass
regression" in a pristine tree so far was our harness diverging from upstream, not a broken repo.

The structural answer to finding these one instance at a time is the **closure probe**: `prepare` now performs the
sealed grade's own install, offline against the cache it just filled, and refuses to mark the cache complete unless
that install succeeds. It also drives the closure to completion — each round downloads exactly what the sealed
install named as missing, three rounds at most. Run `NKLEIN_SWEBENCH_GRADER_LOG_DIR=<dir>` to keep full grader
transcripts; the receipt's 2 kB tail cannot diagnose an install.

## The gate's unit is the CLOSURE, not the spec (2026-09-17)

The 2026-09-16 gate below proved **one instance per spec** — and a spec spans many base commits whose declared
build requirements differ. The first instance of the first scored run walked straight into the gap (findings 44
and 45): a pristine `astropy__astropy-13398` scored 0 of 68 because its closure held its *sibling's* cython pin.

Scanning all 502 cached tarballs' `pyproject.toml` and `setup.py`: **11 of 81 specs carry more than one distinct
build-requirements set, and there are 96 distinct closures, not 81.** The gate's unit is now the
`(spec, build-requirements)` pair. The 81 receipts below stand; the 15 variants they never covered are proven
separately in `docs/benchmarks/swebench-controls-variants-2026-09-17.jsonl`.

The rule this leaves behind: **whenever the closure is shared by more instances than the control proved, the gate
is open however green it looks.** A closure that one instance proves must be one that every instance uses.

## The gate is closed (2026-09-16)

**81 of 81 environments pass their negative control** — every one graded with the test patch applied and NO fix,
where all 10,729 pass-to-pass ids must pass by construction. The per-spec receipts are archived beside this
runbook as `docs/benchmarks/swebench-controls-2026-09-16.jsonl`.

Getting here took **57 defects**, every one in this harness rather than in a repository. Two would have
corrupted scores silently rather than failing loudly, and they are the ones to remember:

- **tox ran the tests in an environment we never built.** Even with `--runner current-env` it prepends
  `.tox/<env>/bin` to PATH, so pytest and every import resolved from a virtualenv the sealed install never
  touched. Nine sphinx specs failed and six PASSED BY LUCK, because that private environment happened to hold
  what they needed.
- **green read as red, twice.** ANSI colour made `PASSED` lines invisible to the parser, and the era pytest
  writes `<id> PASSED` where the modern one writes `PASSED <id>`. A suite printing `322 passed` scored zero.

**71 ids are sealed across 11 specs**, each with its cause on the receipt: tests that reach the internet, ids
that do not exist in this checkout, and a handful that fail in a pristine tree for reasons the environment does
not explain. A score always says what it did not run.

## Known gaps (2026-09-16)

- ~~**Submodule-era astropy (`astropy/astropy` 1.3 and 3.1 — 6 Verified instances).**~~ CLOSED 2026-09-16
  (`8b914eb28`): `materialize` reads the gitlinks out of the parent tree, pairs each with the URL `.gitmodules`
  records, mirrors that repository once, archives it at the commit the parent pins, and re-tars the whole tree.
- **Network-bound graded tests are excluded, not failed.** Some pass-to-pass tests reach the internet by design
  (matplotlib's `test_https_imread_smoketest`, requests' timeout tests). Upstream grades online and they pass; a
  sealed grade cannot run them. A control records each one with the exception that proved it, the grade excludes it
  through the same seal the hand-proven tranche entries use, and the verdict NAMES every exclusion.
- **Platform substitutions are recorded, not silent.** Some pins have no distribution that works on aarch64 or on an
  era interpreter — conda-only GUI toolkits (`pyqt`, `pygobject`, `wxpython`, `gtk3`/`gtk4`), `scipy==1.5.2` with no
  cp36 wheel, `bcrypt` on cp36. The prepare records them in `SWEBENCH_UNRESOLVED.txt` beside the wheels, the grade
  drops exactly those, and the verdict NAMES them as an environment substitution.
- **matplotlib env images** install texlive per upstream's `pre_install` (multiple GB each, 6 images). They need
  Docker disk headroom; build them alone, not beside the download sweep.

## Scale and cost (measured on the tranche, 2026-09-15)

| seat | minutes per instance | cost per instance via the Claude CLI |
|---|---|---|
| Opus 5 | 9 | ~$4 |
| Fable 5.1 | 14 | ~$12 |
| Sonnet 5 | 20 | ~$5 |
| Haiku 4.5 | 15 | ~$1.2 |
| qwen3.8 27b on the m5max | 41 | local |
| qwen3.6-35b-a3b on the Legion, qwen3.8 IQ4_XS on the m4 mini | 33–42 | local |

Verified (500) on one Claude arm at `--parallel 4`: roughly 20–40 hours and Opus ≈ $2k, Fable ≈ $6k, Sonnet ≈ $2.5k,
Haiku ≈ $0.6k. A local seat at one instance at a time: ~14 days per 500. Enabling is not running — runs are an
explicit decision with those numbers in front of it.
