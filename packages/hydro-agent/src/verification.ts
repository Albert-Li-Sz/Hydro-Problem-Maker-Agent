import { assertValidHydroProblemSpec, type HydroProblemSpec } from "@hydro-problem-make/authoring";
import type { HydroReferenceProgram, HydroSandbox, HydroSandboxReport } from "./sandbox.ts";

export async function verifyReferenceProgram(
	sandbox: HydroSandbox,
	program: HydroReferenceProgram,
	problem: HydroProblemSpec,
	signal?: AbortSignal,
): Promise<HydroSandboxReport> {
	assertValidHydroProblemSpec(problem);
	const groups = new Map<
		string,
		{
			timeLimitMs: number;
			memoryLimitMb: number;
			cases: Array<{ input: string; expectedOutput: string; index: number }>;
		}
	>();
	let index = 0;
	for (const subtask of problem.subtasks) {
		for (const item of subtask.cases) {
			const time = item.timeLimit ?? subtask.timeLimit ?? problem.timeLimit;
			const memory = item.memoryLimit ?? subtask.memoryLimit ?? problem.memoryLimit;
			const timeLimitMs = Math.ceil(Number.parseFloat(time) * (time.endsWith("ms") ? 1 : 1000));
			const unit = memory.toLowerCase().match(/[kmg]/)?.[0];
			const memoryLimitMb = Math.ceil(
				Number.parseFloat(memory) * (unit === "g" ? 1024 : unit === "k" ? 1 / 1024 : 1),
			);
			const key = `${timeLimitMs}/${memoryLimitMb}`;
			const group = groups.get(key) ?? { timeLimitMs, memoryLimitMb, cases: [] };
			group.cases.push({
				input: typeof item.input === "string" ? item.input : Buffer.from(item.input).toString("utf8"),
				expectedOutput: typeof item.output === "string" ? item.output : Buffer.from(item.output).toString("utf8"),
				index: index++,
			});
			groups.set(key, group);
		}
	}
	const report: HydroSandboxReport = { success: true, compiled: true, compileOutput: "", cases: [] };
	for (const group of groups.values()) {
		for (let offset = 0; offset < group.cases.length; offset += 100) {
			const cases = group.cases.slice(offset, offset + 100);
			const result = await sandbox.run(
				{ program, cases, timeLimitMs: group.timeLimitMs, memoryLimitMb: group.memoryLimitMb },
				signal,
			);
			report.success &&= result.success;
			report.compiled &&= result.compiled;
			if (result.compileOutput) report.compileOutput = result.compileOutput;
			report.cases.push(...result.cases.map((item) => ({ ...item, index: cases[item.index].index })));
			if (!result.compiled) return report;
		}
	}
	report.cases.sort((a, b) => a.index - b.index);
	return report;
}
