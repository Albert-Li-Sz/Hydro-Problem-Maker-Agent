import { isSafeFlatName } from "@hydro-problem-make/authoring";
import type { HydroReferenceProgram } from "./sandbox.ts";

export interface AuthoringCase {
	id: string;
	purpose: "sample" | "boundary" | "random" | "stress";
	input?: string;
	generatorArgs?: string[];
	expectedOutput?: string;
	oracle?: boolean;
	timeLimitMs?: number;
	memoryLimitMb?: number;
}

export interface HydroAuthoringProject {
	reference: HydroReferenceProgram;
	oracle: HydroReferenceProgram;
	generator: string;
	validator: string;
	checker?: string;
	cases: AuthoringCase[];
	invalidInputs: string[];
	checkerProbes?: Array<{ caseId: string; output: string; accept: boolean; description: string }>;
	wrongPrograms: Array<{ name: string; program: HydroReferenceProgram }>;
	timeLimitMs: number;
	memoryLimitMb: number;
	analysis: string;
}

export interface AuthoringCheck {
	stage: string;
	caseId?: string;
	passed: boolean;
	message: string;
}

export interface VerifiedAuthoringCase {
	id: string;
	input: string;
	output: string;
	durationMs: number;
	timeLimitMs: number;
	memoryLimitMb: number;
}

export interface HydroAuthoringReport {
	success: boolean;
	checks: AuthoringCheck[];
	cases: VerifiedAuthoringCase[];
}

export interface AuthoringSummary {
	verificationId: string;
	success: boolean;
	testCases: number;
	generatedCases: number;
	oracleCases: number;
	validatorNegativeCases: number;
	checker: "default" | "testlib";
	checkerProbes: number;
	wrongPrograms: number;
	checks: AuthoringCheck[];
}

export interface AuthoringEvidence {
	project: HydroAuthoringProject;
	report: HydroAuthoringReport;
	summary: AuthoringSummary;
}

export function validateAuthoringProject(project: HydroAuthoringProject): void {
	if (!project.analysis.trim()) throw new Error("请说明算法、独立对拍方法和测试覆盖计划。");
	for (const program of [project.reference, project.oracle, ...project.wrongPrograms.map((item) => item.program)]) {
		if (
			!["cpp17", "python3", "java"].includes(program.language) ||
			!program.code.trim() ||
			program.code.length > 200000
		)
			throw new Error("程序须为 C++17、Python 3 或 Java，且不超过 200000 字符。");
	}
	if (project.reference.code.trim() === project.oracle.code.trim())
		throw new Error("独立对拍程序不能复制标程；请使用暴力枚举或另一种独立算法。");
	for (const [role, code, registration] of [
		["generator", project.generator, "registerGen"],
		["validator", project.validator, "registerValidation"],
		...(project.checker ? [["checker", project.checker, "registerTestlibCmd"]] : []),
	]) {
		if (code.length > 200000 || !/#include\s*[<"]testlib\.h[>"]/.test(code) || !code.includes(`${registration}(`))
			throw new Error(`${role} 须为引用 testlib.h 并调用 ${registration} 的完整 C++ 程序。`);
	}
	if (project.cases.length < 1 || project.cases.length > 300)
		throw new Error("每次验证需要 1–300 个测试点，可通过 generatorArgs 指定种子和规模。");
	if (!project.cases.some((item) => item.generatorArgs)) throw new Error("至少一个测试点须由 testlib 生成器产生。");
	if (!project.cases.some((item) => item.oracle)) throw new Error("至少一个测试点须执行独立对拍。");
	const ids = new Set<string>();
	for (const item of project.cases) {
		if (!isSafeFlatName(item.id) || ids.has(item.id)) throw new Error("测试点 ID 必须是唯一的 ASCII 文件名。");
		ids.add(item.id);
		if ((item.input !== undefined) === (item.generatorArgs !== undefined))
			throw new Error(`${item.id} 需且仅需提供 input 或 generatorArgs。`);
		if (item.generatorArgs && (item.generatorArgs.length < 1 || item.generatorArgs.some((arg) => arg.includes("\0"))))
			throw new Error("生成器参数需要固定种子，且不能包含 NUL。");
		const time = item.timeLimitMs ?? project.timeLimitMs;
		const memory = item.memoryLimitMb ?? project.memoryLimitMb;
		if (
			!Number.isInteger(time) ||
			time < 50 ||
			time > 10000 ||
			!Number.isInteger(memory) ||
			memory < 32 ||
			memory > 512
		)
			throw new Error("验证限制为 50–10000 ms、32–512 MiB。");
	}
	if (!project.invalidInputs.length || project.invalidInputs.length > 100)
		throw new Error("需要 1–100 个非法输入反例，以验证输入校验器确实拒绝越界或格式错误。");
	if (!project.wrongPrograms.length || project.wrongPrograms.length > 10)
		throw new Error("需要 1–10 个已知错误程序，检验数据是否能区分常见错误。");
	if (project.checker) {
		const probes = project.checkerProbes ?? [];
		if (!probes.some((probe) => probe.accept) || !probes.some((probe) => !probe.accept))
			throw new Error("SPJ 需要合法替代答案与非法答案两类探针。");
		if (probes.length > 100 || probes.some((probe) => !ids.has(probe.caseId)))
			throw new Error("SPJ 探针须引用已有测试点，最多 100 个。");
	}
}
