# Hydro release contract

This reference describes the platform's batch-problem and testlib SPJ target. The implementation and live test instance determine acceptance when they disagree with prose.

## Release package

Use one flat first-level directory per problem:

```text
<slug>/
├── problem.yaml
├── problem_zh.md
├── testdata/
│   ├── config.yaml
│   ├── 1.in
│   └── 1.out
└── additional_file/
    └── figure.svg
```

- `problem.yaml` contains a non-empty `title`, optional alphanumeric non-numeric `pid`, and `tag` string array.
- Chinese statements use `problem_zh.md`. Pair sample fences as `input1`/`output1`, `input2`/`output2`, and so on.
- Put public images and downloads directly in `additional_file/`. Reference them as `file://<filename>` and verify every reference.
- Keep test data directly in `testdata/`. Do not rely on nested directories surviving import.
- Exclude `std/` because Hydro imports it by submitting code. Exclude `solution/` because Hydro publishes it as the problem solution.

## Default judging configuration

Write every decision explicitly:

```yaml
type: default
checker_type: default
time: 1s
memory: 256m
subtasks:
  - id: 1
    type: sum
    score: 100
    cases:
      - input: 1.in
        output: 1.out
```

- Scores across subtasks total exactly 100.
- Use `sum` for point scoring and `min` for bundled subtasks.
- Give every subtask an explicit positive integer `id`. Dependencies refer to those IDs and require live scoring verification.
- Do not mix deprecated top-level `cases` with `subtasks`.
- Every input and output reference exists exactly once.

The default checker normalizes CRLF, ignores trailing spaces or tabs on each line, and ignores trailing blank lines. It still distinguishes leading whitespace, whitespace inside a line, and line breaks in the middle of output. Local answer checking must implement the same behavior.

## Evidence gates

For problems needing special judging, use `type: default`, `checker_type: testlib`,
and `checker: checker.cc`. The platform writes the verified C++ source to
`testdata/checker.cc`; Hydro provides `testlib.h` automatically. Local execution
uses the same argument order: checker input contestant-output reference-output.
Source: https://hydro.js.org/zh/docs/Hydro/user/testdata .

Authoring sources use testlib pinned at
`1e4e8a24c79c6bad3becbdb5a332ffc352b7d5dd` from
https://github.com/MikeMirzayanov/testlib . The authoring download includes the
header and its license. Canonical sample outputs remain external evidence;
answers for generated tests come from the executed reference program.

A completed release records these results separately:

1. The statement, constraints, samples, solution explanation, and configured judging semantics agree.
2. The reference solution compiles and passes the samples.
3. Generated tests pass the input validator; deliberate invalid inputs are rejected.
4. The reference solution agrees with an independent oracle on feasible exhaustive and seeded random cases.
5. Boundary and maximum-size cases complete within the intended limits with appropriate headroom.
6. Representative wrong solutions fail the intended cases or subtasks.
7. The release directory passes the deterministic package validator.
8. When a test Hydro instance is configured, the actual import is inspected, the reference solution receives AC/100, and known-wrong solutions receive the expected verdict or partial score.

Hydro can catch an individual import error and continue. A successful CLI process exit alone does not satisfy the live import gate.
