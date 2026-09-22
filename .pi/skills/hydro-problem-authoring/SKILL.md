---
name: hydro-problem-authoring
description: Turn a supplied programming-problem statement and optional authoring materials into a reviewed, tested Hydro problem project and import package. Use when creating, repairing, validating, or packaging a Hydro problem; do not use for solving a contestant submission.
---

# Hydro Problem Authoring

Produce two traceable outputs: a minimal Hydro import package and a separate authoring project containing private source material and validation evidence.

Follow [references/hydro-contract.md](references/hydro-contract.md) before creating or changing package files. The platform preloads this reference into the system prompt.

## Workflow

1. Preserve the supplied statement and files as the source revision. Extract the title, input and output contract, constraints, samples, limits, judging semantics, and requested subtasks. Prefer the actual statement over suggested metadata. User clarification in subsequent turns resolves earlier conflicts; do not ask answered questions again.
2. Normalize the release target to a structured problem specification. Keep statement edits reviewable against the source.
3. Write a correct reference solution and a genuinely independent small-instance oracle (brute force, enumeration, or a different algorithm). Write a C++ testlib generator, strict C++ testlib validator, boundary and maximum-size cases, and representative wrong solutions. For multiple valid answers, construction, or numerical tolerance, also write a C++ testlib checker. Explain the algorithm and test coverage in the project's analysis.
4. Use deterministic tools for file writes, compilation, generation, validation, differential testing, judging, and packaging. Treat tool results as evidence; never infer that a command passed because the proposed code looks correct.
5. Ask concise questions in Chinese only when unresolved problem semantics affect valid inputs or expected outputs, and always use `request_hydro_clarification` to do so. Plain-text questions do not pause a run. Supplied code and suggested metadata are fallible: if they disagree with a complete statement, explain the discrepancy, generate the correct program, and continue automatically. A truncated display sample is computable, not missing semantics. Preserve its display text and compute the full answer. No-input problems use an empty `.in`. Fix compilation, generator, validator, checker and comparison failures yourself and retry.
6. Export only after the current revision passes its required gates. Record the statement revision, Skill version, model, toolchain, random seeds, artifact hashes, and validation results.

## Boundaries

- Support ordinary batch problems with `checker_type: default` and C++ testlib SPJ with `checker_type: testlib`. Interactive, communication, strictly answer-submission, and objective judging need a separate backend; explain that limitation only when the supplied problem actually requires it.
- A historical mention of submitting answers does not require answer-submission judging when the current statement explicitly permits programs. Use ordinary program judging in that case. Do not change an explicitly required answer-only judging mode without clarification.
- Generated programs run only through the configured sandbox. They must not receive model credentials, service credentials, or unrestricted workspace access.
- A reference solution passing answers it generated itself is insufficient evidence. Prefer an independent oracle for small cases and representative known-wrong solutions.
- Keep reference solutions, generators, validators, seeds, and internal reports in the authoring project. Do not place them in `std/`, `solution/`, or public attachments.
- Distinguish local package validity, algorithm/data validation, and live Hydro import and judging. Report each status separately.

## Platform Tools

The platform binds the run directory and restores the Pi session when the user continues a task. Use only the tools listed in the current session; do not request filesystem paths or run identifiers.

1. `run_reference_program` is an optional exploration tool. Supply any generated C++17, Python 3, or Java (`Main`) program. Set `role: candidate` for experiments and old/wrong uploaded code. Uploads never lock the reference program.
2. Build the persistent project with several focused `update_hydro_authoring` calls instead of one large payload. A practical order is programs and testlib sources, then cases and invalid inputs, then wrong programs, limits and analysis. Arrays replace their previous value. Repair only the field that failed. Use `#include "testlib.h"`; generator calls `registerGen(argc, argv, 1)` and testlib `rnd`; validator calls `registerValidation(argc, argv)`, enforces explicit bounds and separators, then `inf.readEof()`. Every case uses either manual `input` or `generatorArgs` with a fixed seed. Store complete known sample answers in `expectedOutput`. Select affordable cases with `oracle: true`; cover small random instances, edge cases and maximum-size stress instances. Include malformed/out-of-range `invalidInputs` and representative `wrongPrograms`.
3. For SPJ use `registerTestlibCmd(argc, argv)` with `inf`=input, `ouf`=contestant output, `ans`=reference output. Validate the answer's semantics and full output, enforce tolerances explicitly, and return `_ok` or `_wa`/`_pe`; partial-score and multi-pass checkers are outside this pipeline. Supply checker probes for a different valid answer and for semantic errors, empty/truncated output, extra tokens, duplicates, out-of-range values, NaN/Inf when applicable. A checker crash or `_fail` is an error, not a successful negative test.
4. Call `verify_hydro_authoring` with `mode: "quick"`. Inspect the compact failure list and patch only the affected draft fields. Quick mode checks a representative subset and may leave wrong programs alive. Once quick mode passes, call it with `mode: "full"`. Full mode compiles once per component, checks generator reproducibility, validates all input, runs the reference under declared limits, compares samples and the independent oracle, kills every known-wrong solution, and tests the SPJ. Identical project revisions reuse cached results. Exact generated input/output stays private; never print or transcribe it.
5. Only a successful full verification returns `verificationId`. Call `build_hydro_problem` with it. Every subtask case supplies `caseId`, `inputFile` and `outputFile`; omit `input` and `output`. Include every verified case exactly once, preserve the verified limits, and sum subtask scores to 100. The platform injects the verified SPJ and user-uploaded attachments automatically. Explain scoring/coverage choices when the statement does not prescribe subtasks.
6. Call `validate_hydro_package`. Report the actual case count, oracle comparisons, validator negatives, wrong programs rejected and SPJ probes. The web page offers a Hydro ZIP and a separate authoring ZIP containing sources, seeds, data and reports. When a live Hydro adapter is configured, the user can additionally import and judge the package there; otherwise report that stage as unconfigured without blocking a locally verified export.

If no sandbox tool is enabled, normalize the supplied complete data in format-authoring mode and explicitly report program execution as not run. Never claim sandbox execution or live Hydro judging without tool evidence.
