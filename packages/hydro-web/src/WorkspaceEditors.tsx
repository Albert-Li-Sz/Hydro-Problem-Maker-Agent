import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { CaseDraft, ProblemDraft } from "./problem.ts";

interface StatementEditorProps {
	draft: ProblemDraft;
	previewStatement: string;
	onStatementChange: (value: string) => void;
	onLoadExample: () => void;
}

export function StatementEditor(props: StatementEditorProps) {
	return (
		<div className="editor-grid">
			<div className="editor-pane">
				<div className="pane-heading">
					<strong>Markdown 题面</strong>
					{!props.draft.statement.trim() ? (
						<button className="text-button" type="button" onClick={props.onLoadExample}>
							载入 A+B 示例
						</button>
					) : (
						<span>样例由测试数据自动附加</span>
					)}
				</div>
				<textarea
					className="statement-editor"
					value={props.draft.statement}
					onChange={(event) => props.onStatementChange(event.target.value)}
					spellCheck={false}
					aria-label="Markdown 题面"
					placeholder="在此粘贴完整题面。题目名称和标签可留空，由 Agent 提取。"
				/>
			</div>
			<div className="preview-pane">
				<div className="pane-heading">
					<strong>Hydro 风格预览</strong>
					<span>Markdown · GFM · KaTeX</span>
				</div>
				<article className="problem-preview">
					<ReactMarkdown
						remarkPlugins={[remarkGfm, remarkMath]}
						rehypePlugins={[rehypeKatex]}
						urlTransform={(url) => (url.startsWith("data:") ? url : defaultUrlTransform(url))}
					>
						{props.previewStatement}
					</ReactMarkdown>
				</article>
			</div>
		</div>
	);
}

interface TestDataEditorProps {
	cases: CaseDraft[];
	onChange: (index: number, field: keyof CaseDraft, value: string) => void;
	onRemove: (index: number) => void;
	onAdd: () => void;
}

export function TestDataEditor(props: TestDataEditorProps) {
	return (
		<div className="tab-body">
			<div className="info-strip">
				当前测试点会组成一个 100 分逐点计分子任务。它们是已有材料，不代表已经覆盖边界或通过对拍。
			</div>
			<div className="test-list">
				{props.cases.map((testCase, index) => (
					<div className="test-card" key={`case-${index + 1}`}>
						<div className="test-card-heading">
							<strong>测试点 {index + 1}</strong>
							<span>
								{index + 1}.in / {index + 1}.out
							</span>
						</div>
						<div className="test-columns">
							<label>
								<span>输入</span>
								<textarea
									value={testCase.input}
									onChange={(event) => props.onChange(index, "input", event.target.value)}
								/>
							</label>
							<label>
								<span>标准输出</span>
								<textarea
									value={testCase.output}
									onChange={(event) => props.onChange(index, "output", event.target.value)}
								/>
							</label>
						</div>
						<button className="text-button danger" type="button" onClick={() => props.onRemove(index)}>
							删除测试点
						</button>
					</div>
				))}
			</div>
			<button className="button secondary" type="button" onClick={props.onAdd}>
				添加测试点
			</button>
		</div>
	);
}
