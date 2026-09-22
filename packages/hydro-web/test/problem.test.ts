import { describe, expect, it } from "vitest";
import {
	createAgentSource,
	createProblemRequest,
	emptyDraft,
	type ProblemDraft,
	parseTags,
	samplesFromAgentSource,
	statementWithSamples,
} from "../src/problem.ts";

const draft: ProblemDraft = {
	slug: "a-plus-b",
	title: "A + B",
	tags: "入门, 模拟，入门",
	timeLimit: "1s",
	memoryLimit: "256m",
	statement: "# A + B\n\n计算两数之和。",
	cases: [
		{ input: "1 2", output: "3" },
		{ input: "-5 8\n", output: "3\n" },
	],
};

describe("problem request", () => {
	it("does not mix A+B defaults into a pasted statement", () => {
		const source = createAgentSource({ ...emptyDraft, statement: "# 三连击\n\n输入：无。" });
		expect(source).toContain("# 三连击");
		expect(source).not.toContain("1 2");
		expect(source).not.toContain("a-plus-b");
		expect(source).not.toContain("A + B");
		expect(source).not.toContain("## 样例");
	});

	it("preserves zero-byte input for no-input problems", () => {
		const request = createProblemRequest({ ...emptyDraft, cases: [{ input: "", output: "192 384 576" }] }, []);
		expect(request.problem.subtasks[0].cases[0].input).toBe("");
	});
	it("normalizes tags without changing their order", () => {
		expect(parseTags(draft.tags)).toEqual(["入门", "模拟"]);
	});

	it("adds Hydro sample fences to the release statement", () => {
		expect(statementWithSamples(draft)).toContain("```input1\n1 2\n```");
		expect(statementWithSamples(draft)).toContain("```output2\n3\n```");
	});

	it("creates one explicit 100-point subtask and preserves attachments", () => {
		const request = createProblemRequest(draft, [
			{ name: "figure.png", contentBase64: "aW1hZ2U=", dataUrl: "data:image/png;base64,aW1hZ2U=" },
		]);
		expect(request.problem).toMatchObject({
			slug: "a-plus-b",
			tags: ["入门", "模拟"],
			subtasks: [{ id: 1, type: "sum", score: 100 }],
			attachments: [{ name: "figure.png", contentBase64: "aW1hZ2U=" }],
		});
		expect(request.problem.subtasks[0].cases).toEqual([
			{ inputFile: "1.in", input: "1 2\n", outputFile: "1.out", output: "3\n" },
			{ inputFile: "2.in", input: "-5 8\n", outputFile: "2.out", output: "3\n" },
		]);
	});

	it("builds an Agent source with explicit limits and samples", () => {
		const source = createAgentSource(draft);
		expect(source).toContain("- 时间限制：1s");
		expect(source).toContain("## 用户提供的题面");
		expect(source).toContain("```input1\n1 2\n```");
	});

	it("loads the historical task's samples without borrowing a new draft's tests", () => {
		expect(samplesFromAgentSource(createAgentSource(draft))).toEqual([
			{ input: "1 2\n", output: "3\n" },
			{ input: "-5 8\n", output: "3\n" },
		]);
		expect(samplesFromAgentSource("```input\n```\n\n```output\n42\n```")).toEqual([{ input: "", output: "42\n" }]);
		expect(samplesFromAgentSource("```input1\n  \n```\n```output1\n42\n```\n```input2\n5\n```")).toEqual([
			{ input: "  \n", output: "42\n" },
		]);
	});
});
