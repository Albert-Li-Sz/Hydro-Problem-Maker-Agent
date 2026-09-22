import { Type } from "typebox";

export const programSchema = Type.Object({
	language: Type.Union([Type.Literal("cpp17"), Type.Literal("python3"), Type.Literal("java")]),
	code: Type.String({ minLength: 1, maxLength: 200000 }),
});
const cppSource = Type.String({
	minLength: 1,
	maxLength: 200000,
	description: "Complete C++17 source using testlib.h",
});

export const authoringProjectSchema = Type.Object({
	reference: programSchema,
	oracle: programSchema,
	generator: cppSource,
	validator: cppSource,
	checker: Type.Optional(cppSource),
	cases: Type.Array(
		Type.Object({
			id: Type.String({ description: "Unique flat ASCII case ID, used later by build_hydro_problem" }),
			purpose: Type.Union([
				Type.Literal("sample"),
				Type.Literal("boundary"),
				Type.Literal("random"),
				Type.Literal("stress"),
			]),
			input: Type.Optional(Type.String({ description: "Manual input; empty string for no-input problems" })),
			generatorArgs: Type.Optional(
				Type.Array(Type.String(), {
					description: "Generator argv including a fixed seed; mutually exclusive with input",
					minItems: 1,
				}),
			),
			expectedOutput: Type.Optional(
				Type.String({
					description: "Known sample answer, if complete; all final answers are computed by the reference",
				}),
			),
			oracle: Type.Optional(
				Type.Boolean({ description: "Run independent oracle on small or otherwise affordable instances" }),
			),
			timeLimitMs: Type.Optional(Type.Integer({ minimum: 50, maximum: 10000 })),
			memoryLimitMb: Type.Optional(Type.Integer({ minimum: 32, maximum: 512 })),
		}),
		{ minItems: 1, maxItems: 300 },
	),
	invalidInputs: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: 100,
		description: "Out-of-range or malformed inputs the validator must reject",
	}),
	checkerProbes: Type.Optional(
		Type.Array(
			Type.Object({
				caseId: Type.String(),
				output: Type.String(),
				accept: Type.Boolean(),
				description: Type.String(),
			}),
			{
				maxItems: 100,
				description: "For SPJ: alternate correct answers AND malformed/incorrect answers with expected verdicts",
			},
		),
	),
	wrongPrograms: Type.Array(Type.Object({ name: Type.String(), program: programSchema }), {
		minItems: 1,
		maxItems: 10,
	}),
	timeLimitMs: Type.Integer({ minimum: 50, maximum: 10000 }),
	memoryLimitMb: Type.Integer({ minimum: 32, maximum: 512 }),
	analysis: Type.String({
		minLength: 1,
		description:
			"Algorithm proof, oracle independence, input constraints, generator modes/seed plan, boundary/stress coverage and checker semantics",
	}),
});
