# Hydro agent adapter

This private package embeds Pi with the project-owned Hydro authoring Skill and a narrow tool set. It does not expose Pi's shell or general file mutation tools to authoring sessions.

Artifacts are addressed by safe run IDs and problem slugs, then stored below `artifacts/<run-id>/hydro/` in the assigned workspace.

Authoring sessions expose `run_reference_program` for exploration, `verify_hydro_authoring` for complete testlib authoring, `build_hydro_problem`, and `validate_hydro_package`. Uploaded code is optional and replaceable; candidate tests never replace the selected reference.

The authoring tool compiles a reference solution, independent oracle, C++ testlib generator and validator, known-wrong solutions, and an optional C++ testlib SPJ. It generates deterministic data, checks all input, runs samples and differential tests, tests validator rejection and checker probes, and requires wrong solutions to fail. Building uses the successful verification ID and case IDs to copy the exact verified bytes with matching resource limits. Failed verification blocks release; the executor can prompt up to two additional repair rounds if a model ends its turn prematurely.

Private sources, seeds, data and reports live in `artifacts/<run-id>/authoring/<verification-id>/`. The separate authoring download includes these materials, the pinned testlib header and license, original statement and a SHA-256 manifest. The Hydro ZIP contains only judging files and public material; SPJ uses `checker_type: testlib` and `checker: checker.cc`. Interactive and partial-score/multi-pass checker workflows are not implemented. Local checks do not replace mathematical correctness arguments or live Hydro judging.

Build the local execution image from the repository root:

```bash
docker build -t hydro-problem-make/sandbox:local packages/hydro-agent/sandbox
```

Keep Docker running. Override the image using `HYDRO_SANDBOX_IMAGE`. Runs use disposable Linux containers with no network or host directory mounts. Supported per-case limits are 50–10000 ms and 32–512 MiB, up to 100 cases per invocation, and 1 MiB per output stream. The container has a 1 GiB total ceiling; C++/Python additionally use a per-process address-space limit, while Java uses the configured heap limit with separate JVM overhead. These are local authoring checks, not an exact reproduction of a target judge's accounting.

The complete authoring tool supports 300 cases per project, 16 MiB per output stream, 64 MiB of final input/output data, and a 15-minute container deadline. Testlib is pinned to `1e4e8a24c79c6bad3becbdb5a332ffc352b7d5dd`. Rebuild the image after updating this checkout.

Pi transcripts persist in `sessions/<run-id>/`. Clarifications resume the same transcript, and legacy tasks without a transcript reconstruct context from the original source and saved conversation.

Run the opt-in Docker tests from this package directory:

```bash
HYDRO_TEST_SANDBOX=1 node ../../node_modules/vitest/dist/cli.js --run test/sandbox.test.ts test/executor.test.ts test/authoring-project.test.ts
```

The executor tests use an in-process faux AI provider; no live model calls are made.
