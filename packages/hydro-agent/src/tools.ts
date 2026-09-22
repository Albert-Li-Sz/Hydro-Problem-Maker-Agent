import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { HydroProblemSpec } from "@hydro-problem-make/authoring";
import { Type } from "typebox";
import type { AuthoringSummary } from "./authoring-project.ts";
import { authoringProjectSchema, programSchema } from "./authoring-schema.ts";
import type { HydroReferenceProgram, HydroSandbox } from "./sandbox.ts";
import { verifyReferenceProgram } from "./verification.ts";
import {
	buildProblemArtifact,
	loadAuthoringEvidence,
	saveAuthoringEvidence,
	saveReferenceEvidence,
	validateProblemArtifact,
} from "./workspace.ts";

const testCaseSchema = Type.Object({
	inputFile: Type.String({ description: "Flat .in filename" }),
	input: Type.Optional(Type.String({ description: "Manual packing only; verified agent packages use caseId" })),
	outputFile: Type.String({ description: "Flat .out or .ans filename" }),
	output: Type.Optional(Type.String({ description: "Manual packing only; verified agent packages use caseId" })),
	caseId: Type.Optional(
		Type.String({
			description: "ID of a case from verify_hydro_authoring; input/output are loaded from verified files",
		}),
	),
	timeLimit: Type.Optional(Type.String()),
	memoryLimit: Type.Optional(Type.String()),
});

const subtaskSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
	type: Type.Union([Type.Literal("sum"), Type.Literal("min")]),
	score: Type.Integer({ minimum: 1, maximum: 100 }),
	dependsOn: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
	timeLimit: Type.Optional(Type.String()),
	memoryLimit: Type.Optional(Type.String()),
	cases: Type.Array(testCaseSchema, { minItems: 1 }),
});

const problemSchema = Type.Object({
	slug: Type.String({ description: "Flat ASCII problem slug" }),
	title: Type.String({ minLength: 1 }),
	pid: Type.Optional(Type.String()),
	tags: Type.Array(Type.String()),
	language: Type.String({ description: "Hydro statement language code such as zh" }),
	statement: Type.String({ minLength: 1 }),
	timeLimit: Type.String(),
	memoryLimit: Type.String(),
	subtasks: Type.Array(subtaskSchema, { minItems: 1 }),
	attachments: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String({ description: "Flat ASCII attachment filename" }),
				content: Type.String({
					description: "UTF-8 attachment content; binary upload support is handled before this tool",
				}),
			}),
		),
	),
});

export function createHydroAuthoringTools(
	workspaceRoot: string,
	runId: string,
	options: { sandbox?: HydroSandbox; referenceProgram?: HydroReferenceProgram } = {},
): ToolDefinition[] {
	let referenceProgram = options.referenceProgram;
	const buildTool = defineTool({
		name: "build_hydro_problem",
		label: "Build Hydro problem",
		description:
			"Validate a complete normalized problem specification and materialize a new Hydro release directory.",
		promptSnippet: "Build a validated Hydro release directory from a complete structured problem specification",
		promptGuidelines: [
			"Call build_hydro_problem only after the statement, limits, scoring, test data, and attachments are complete.",
			"A successful tool result includes package structure and any standard-program checks; report independent algorithm and live-Hydro evidence separately.",
		],
		parameters: Type.Object({
			problem: problemSchema,
			verificationId: Type.Optional(
				Type.String({
					description: "Successful verify_hydro_authoring result; required for sandbox-backed Agent releases",
				}),
			),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			if (options.sandbox && !params.verificationId)
				throw new Error(
					"请先调用 verify_hydro_authoring 完成 testlib 数据生成、输入校验、独立对拍和错误程序验证，再用 verificationId 与 caseId 打包。",
				);
			const evidence = params.verificationId
				? await loadAuthoringEvidence(workspaceRoot, runId, params.verificationId)
				: undefined;
			if (evidence && (!evidence.report.success || !evidence.summary.success))
				throw new Error("制题验证尚未通过，请修复失败项后重新验证。");
			const usedIds = new Set<string>();
			const problem: HydroProblemSpec = {
				...params.problem,
				checker: evidence?.project.checker ? { type: "testlib", source: evidence.project.checker } : undefined,
				subtasks: params.problem.subtasks.map((subtask) => ({
					...subtask,
					cases: subtask.cases.map((item) => {
						if (!evidence) {
							if (item.input === undefined || item.output === undefined)
								throw new Error("手工打包需要完整输入输出。");
							return { ...item, input: item.input, output: item.output };
						}
						const verified = evidence.report.cases.find((value) => value.id === item.caseId);
						if (!verified || usedIds.has(verified.id))
							throw new Error(`测试点 ${item.caseId} 未验证或重复使用。`);
						usedIds.add(verified.id);
						const time = item.timeLimit ?? subtask.timeLimit ?? params.problem.timeLimit;
						const memory = item.memoryLimit ?? subtask.memoryLimit ?? params.problem.memoryLimit;
						const timeMs = Math.ceil(Number.parseFloat(time) * (time.endsWith("ms") ? 1 : 1000));
						const unit = memory.toLowerCase().match(/[kmg]/)?.[0];
						const memoryMb = Math.ceil(
							Number.parseFloat(memory) * (unit === "g" ? 1024 : unit === "k" ? 1 / 1024 : 1),
						);
						if (timeMs !== verified.timeLimitMs || memoryMb !== verified.memoryLimitMb)
							throw new Error(`测试点 ${verified.id} 的发布限制须与验证限制一致，请重新验证或使用原限制。`);
						if (
							(item.input !== undefined && item.input !== verified.input) ||
							(item.output !== undefined && item.output !== verified.output)
						)
							throw new Error("不能修改已验证的数据；只需提供 caseId，平台自动读取输入输出。");
						return { ...item, input: verified.input, output: verified.output };
					}),
				})),
			};
			if (evidence && usedIds.size !== evidence.report.cases.length)
				throw new Error("必须打包本次验证的全部测试点，避免丢失边界或反例。");
			const verification = evidence
				? {
						success: true,
						compiled: true,
						compileOutput: "",
						cases: evidence.report.cases.map((item, index) => ({
							index,
							status: "passed" as const,
							stdout: "",
							stderr: "",
							exitCode: 0,
							durationMs: item.durationMs,
						})),
					}
				: referenceProgram
					? await verifyReferenceProgramRequired(referenceProgram, problem, signal)
					: undefined;
			if (verification && !verification.success)
				throw new Error(`标准程序未通过测试点，修正后再打包：${JSON.stringify(verification)}`);
			const artifact = await buildProblemArtifact(workspaceRoot, runId, problem);
			return {
				content: [
					{
						type: "text",
						text: `Hydro package directory created and validated: ${artifact.directory}`,
					},
				],
				details: { ...artifact, verification, authoring: evidence?.summary },
			};
		},
	});

	const validateTool = defineTool({
		name: "validate_hydro_package",
		label: "Validate Hydro package",
		description: "Inspect an existing generated Hydro release directory and return structured validation evidence.",
		promptSnippet: "Validate a generated Hydro release directory before export",
		parameters: Type.Object({
			slug: Type.String({ description: "Problem slug inside the run's Hydro artifacts" }),
		}),
		executionMode: "parallel",
		async execute(_toolCallId, params) {
			const report = await validateProblemArtifact(workspaceRoot, runId, params.slug);
			return {
				content: [{ type: "text", text: JSON.stringify(report) }],
				details: report,
			};
		},
	});

	async function verifyReferenceProgramRequired(
		program: HydroReferenceProgram,
		problem: HydroProblemSpec,
		signal?: AbortSignal,
	) {
		if (!options.sandbox) throw new Error("标准程序验证需要已配置的 Linux 沙箱。");
		const report = await verifyReferenceProgram(options.sandbox, program, problem, signal);
		await saveReferenceEvidence(workspaceRoot, runId, program, report);
		return report;
	}

	if (!options.sandbox) return [buildTool, validateTool];
	const sandbox = options.sandbox;
	const verifyTool = defineTool({
		name: "verify_hydro_authoring",
		label: "testlib 制题验证",
		description:
			"Compile and run a complete authoring project: C++ testlib generator + strict validator, reference + independent oracle, known-wrong programs, optional C++ testlib SPJ and probes. Materialize all data locally. Returns a verificationId and case IDs; build with those IDs, never transcribe generated files. Fix failures and resubmit a complete project. Uploaded code does not constrain program selection.",
		promptSnippet: "Generate and verify complete testlib data and programs in the Linux sandbox before packaging",
		parameters: Type.Object({ project: authoringProjectSchema }),
		executionMode: "sequential",
		async execute(_id, params, signal) {
			if (!sandbox.verifyProject) throw new Error("当前沙箱未启用 testlib 制题，请更新沙箱镜像。");
			const report = await sandbox.verifyProject(params.project, signal);
			const summary: AuthoringSummary = {
				verificationId: randomUUID(),
				success: report.success,
				testCases: report.cases.length,
				generatedCases: report.checks.filter((item) => item.stage === "generator" && item.passed).length,
				oracleCases: report.checks.filter((item) => item.stage === "oracle" && item.passed).length,
				validatorNegativeCases: report.checks.filter((item) => item.stage === "validator-negative" && item.passed)
					.length,
				checker: params.project.checker ? "testlib" : "default",
				checkerProbes: report.checks.filter((item) => item.stage === "checker-probe" && item.passed).length,
				wrongPrograms: report.checks.filter((item) => item.stage === "wrong-program-killed" && item.passed).length,
				checks: report.checks,
			};
			await saveAuthoringEvidence(workspaceRoot, runId, { project: params.project, report, summary });
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							...summary,
							checks: report.checks.filter((item) => !item.passed),
							cases: report.cases.map(({ id, input, output, durationMs }) => ({
								id,
								inputBytes: Buffer.byteLength(input),
								outputBytes: Buffer.byteLength(output),
								durationMs,
							})),
						}),
					},
				],
				details: summary,
			};
		},
	});
	const runTool = defineTool({
		name: "run_reference_program",
		label: "运行标准程序",
		description:
			"Explore programs in the Linux sandbox. You may replace unrelated or incorrect uploaded code by providing program. Use role=candidate for wrong solutions or experiments without selecting them as the reference. Empty input means no-input problem. For final release use verify_hydro_authoring.",
		promptSnippet: "Run standard programs to generate answers or verify test data in the Linux sandbox",
		parameters: Type.Object({
			role: Type.Optional(Type.Union([Type.Literal("reference"), Type.Literal("candidate")])),
			program: Type.Optional(programSchema),
			cases: Type.Array(Type.Object({ input: Type.String(), expectedOutput: Type.Optional(Type.String()) }), {
				minItems: 1,
				maxItems: 100,
			}),
			timeLimitMs: Type.Optional(Type.Integer({ minimum: 50, maximum: 10000 })),
			memoryLimitMb: Type.Optional(Type.Integer({ minimum: 32, maximum: 512 })),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal) {
			const program = params.program ?? referenceProgram;
			if (!program) throw new Error("请根据题面编写程序并通过 program 参数提交。");
			const report = await sandbox.run({ ...params, program }, signal);
			if (params.role !== "candidate" && report.success) {
				referenceProgram = program;
				await saveReferenceEvidence(workspaceRoot, runId, program, report);
			}
			return { content: [{ type: "text", text: JSON.stringify(report) }], details: report };
		},
	});
	return [runTool, verifyTool, buildTool, validateTool];
}
