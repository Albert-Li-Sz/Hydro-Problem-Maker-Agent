export interface CaseDraft {
	input: string;
	output: string;
}

export interface AttachmentDraft {
	name: string;
	contentBase64: string;
	dataUrl: string;
}

export interface ProblemDraft {
	slug: string;
	title: string;
	tags: string;
	timeLimit: string;
	memoryLimit: string;
	statement: string;
	cases: CaseDraft[];
}

function withTrailingNewline(value: string): string {
	return value.length === 0 || value.endsWith("\n") ? value : `${value}\n`;
}

export const emptyDraft: ProblemDraft = {
	slug: "",
	title: "",
	tags: "",
	timeLimit: "1s",
	memoryLimit: "256m",
	statement: "",
	cases: [],
};

export function parseTags(value: string): string[] {
	return [
		...new Set(
			value
				.split(/[,，]/)
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 0),
		),
	];
}

export function statementWithSamples(draft: ProblemDraft): string {
	if (draft.cases.length === 0) return `${draft.statement.trimEnd()}\n`;
	const samples = draft.cases
		.map(
			(testCase, index) =>
				`### 样例 ${index + 1}\n\n\`\`\`input${index + 1}\n${withTrailingNewline(testCase.input)}\`\`\`\n\n\`\`\`output${index + 1}\n${withTrailingNewline(testCase.output)}\`\`\``,
		)
		.join("\n\n");
	return `${draft.statement.trimEnd()}\n\n## 样例\n\n${samples}\n`;
}

export function createProblemRequest(draft: ProblemDraft, attachments: readonly AttachmentDraft[]) {
	return {
		problem: {
			slug: draft.slug,
			title: draft.title,
			tags: parseTags(draft.tags),
			language: "zh",
			statement: statementWithSamples(draft),
			timeLimit: draft.timeLimit,
			memoryLimit: draft.memoryLimit,
			subtasks: [
				{
					id: 1,
					type: "sum" as const,
					score: 100,
					cases: draft.cases.map((testCase, index) => ({
						inputFile: `${index + 1}.in`,
						input: withTrailingNewline(testCase.input),
						outputFile: `${index + 1}.out`,
						output: withTrailingNewline(testCase.output),
					})),
				},
			],
			attachments: attachments.map(({ name, contentBase64 }) => ({ name, contentBase64 })),
		},
	};
}

export function createAgentSource(draft: ProblemDraft): string {
	return `# 制题请求

- 建议题目名称：${draft.title || "由题面提取"}
- 建议目录标识：${draft.slug || "由题面生成"}
- 时间限制：${draft.timeLimit}
- 内存限制：${draft.memoryLimit}
- 标签：${draft.tags || "由题面提取"}

以用户题面为准，未提供的名称、标识、标签由题面提取。未添加测试点时，由 Agent 根据题意设计测试数据并用标准程序生成输出。无输入题使用空输入文件。

## 用户提供的题面

${statementWithSamples(draft)}`;
}

export function samplesFromAgentSource(source: string): CaseDraft[] {
	const samples = new Map<string, Partial<CaseDraft>>();
	for (const match of source.matchAll(/^```(input|output)(\d*)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)) {
		const sample = samples.get(match[2]) ?? {};
		if (match[1] === "input") sample.input = match[3];
		else sample.output = match[3];
		samples.set(match[2], sample);
	}
	return [...samples.values()].flatMap((sample) =>
		typeof sample.input === "string" && typeof sample.output === "string"
			? [{ input: sample.input, output: sample.output }]
			: [],
	);
}
