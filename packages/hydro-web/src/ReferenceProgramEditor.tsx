import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { apiUrl, type ReferenceProgram, type SandboxReport, type SandboxStatus } from "./platform.ts";
import type { CaseDraft } from "./problem.ts";

interface Props {
	apiOrigin: string;
	program: ReferenceProgram;
	cases: CaseDraft[];
	timeLimit: string;
	memoryLimit: string;
	sandbox?: SandboxStatus;
	onChange: (program: ReferenceProgram) => void;
	onApplyOutputs?: (cases: CaseDraft[]) => void;
	onBackToTask: () => void;
	hasTask: boolean;
}

const statusLabels = {
	generated: "已生成输出",
	passed: "通过",
	wrong_answer: "输出不一致",
	runtime_error: "运行错误",
	time_limit: "超时",
	output_limit: "输出超限",
};

export function ReferenceProgramEditor(props: Props) {
	const [busy, setBusy] = useState(false);
	const [report, setReport] = useState<SandboxReport>();
	const [message, setMessage] = useState("");
	const [testedRevision, setTestedRevision] = useState("");
	const mounted = useRef(true);
	const request = useRef<AbortController | undefined>(undefined);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			request.current?.abort();
		};
	}, []);
	const revision = JSON.stringify([props.program, props.cases, props.timeLimit, props.memoryLimit]);
	const currentReport = testedRevision === revision ? report : undefined;
	const cases = props.cases.length > 0 ? props.cases : [{ input: "", output: "" }];
	async function upload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
		const input = event.currentTarget;
		const file = input.files?.[0];
		try {
			if (!file) return;
			if (file.size > 200000) throw new Error("标准程序文件不能超过 200 KB。");
			const language = file.name.endsWith(".py") ? "python3" : file.name.endsWith(".java") ? "java" : "cpp17";
			const code = await file.text();
			if (!mounted.current) return;
			props.onChange({ language, code });
			setMessage(`已读取 ${file.name}，${props.hasTask ? "继续当前任务" : "运行新任务"}时会一并提交。`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "文件读取失败。");
		} finally {
			input.value = "";
		}
	}
	async function run(): Promise<void> {
		const controller = new AbortController();
		request.current = controller;
		setBusy(true);
		setMessage("正在沙箱中编译并运行……");
		setReport(undefined);
		try {
			const memoryUnit = props.memoryLimit.toLowerCase().match(/[kmg]/)?.[0];
			const response = await fetch(apiUrl(props.apiOrigin, "/sandbox/run"), {
				signal: controller.signal,
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					program: props.program,
					cases: cases.map((item) => ({ input: item.input, expectedOutput: item.output || undefined })),
					timeLimitMs: Math.ceil(Number.parseFloat(props.timeLimit) * (props.timeLimit.endsWith("ms") ? 1 : 1000)),
					memoryLimitMb: Math.ceil(
						Number.parseFloat(props.memoryLimit) *
							(memoryUnit === "g" ? 1024 : memoryUnit === "k" ? 1 / 1024 : 1),
					),
				}),
			});
			const body = (await response.json()) as SandboxReport & { message?: string };
			if (!mounted.current) return;
			if (!response.ok) throw new Error(body.message ?? "沙箱运行失败。");
			setReport(body);
			setTestedRevision(revision);
			setMessage(
				body.success
					? props.hasTask
						? "运行完成，可返回任务并提交补充信息。"
						: "运行完成。可将程序输出填入测试数据。"
					: "发现编译、运行或输出问题，请查看下方记录。",
			);
		} catch (error) {
			if (controller.signal.aborted) return;
			setMessage(error instanceof Error ? error.message : "沙箱运行失败。");
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="tab-body reference-editor">
			<div className="info-strip">
				无需上传也能制题。这里的程序作为可选参考材料；与题面冲突时，Agent
				会说明并自动编写正确标程。生成源码可从任务中下载制题工程。
			</div>
			{props.hasTask && (
				<div className="info-strip">正在编辑当前任务的参考材料。修改只用于“提交补充并继续”，不会带入下一题。</div>
			)}
			<div className="reference-toolbar">
				<label className="field">
					<span>程序语言</span>
					<select
						aria-label="标准程序语言"
						value={props.program.language}
						onChange={(event) =>
							props.onChange({ ...props.program, language: event.target.value as ReferenceProgram["language"] })
						}
						disabled={busy}
					>
						<option value="cpp17">C++17</option>
						<option value="python3">Python 3</option>
						<option value="java">Java（Main 类）</option>
					</select>
				</label>
				<label className="upload-button">
					上传标准程序
					<input
						aria-label="上传标准程序"
						type="file"
						accept=".cpp,.cc,.cxx,.py,.java"
						onChange={upload}
						disabled={busy}
					/>
				</label>
				<span className={`status-badge ${props.sandbox?.available ? "online" : "offline"}`}>
					{props.sandbox?.available ? "Linux 沙箱已就绪" : "沙箱不可用"}
				</span>
			</div>
			<textarea
				className="program-code"
				aria-label="标准程序代码"
				value={props.program.code}
				onChange={(event) => props.onChange({ ...props.program, code: event.target.value })}
				placeholder="粘贴标准程序，或上传 .cpp / .py / .java 文件"
				spellCheck={false}
				disabled={busy}
			/>
			<p className="settings-help">
				{props.cases.length
					? `使用“测试数据”中的 ${props.cases.length} 个测试点；已填输出会比较，空输出会生成。`
					: "当前没有测试点，将使用一个空输入测试点，适用于无输入题。"}{" "}
				Java 程序使用 Main 类。
			</p>
			<div className="settings-actions">
				<button
					className="button primary"
					type="button"
					onClick={run}
					disabled={busy || !props.program.code.trim() || !props.sandbox?.available}
				>
					{busy ? "运行中…" : "编译并运行标准程序"}
				</button>
				{props.hasTask && (
					<button className="button secondary" type="button" onClick={props.onBackToTask}>
						返回任务继续
					</button>
				)}
			</div>
			{message && <output className="connection-result">{message}</output>}
			{currentReport && (
				<section className="sandbox-results">
					<strong>{currentReport.compiled ? "编译通过" : "编译失败"}</strong>
					{currentReport.compileOutput && <pre>{currentReport.compileOutput}</pre>}
					{currentReport.cases.map((item) => (
						<details key={item.index} open={item.status !== "passed"}>
							<summary>
								测试点 {item.index + 1} · {statusLabels[item.status]} · {item.durationMs} ms
							</summary>
							<div className="test-columns">
								<div>
									<small>程序输出</small>
									<pre>{item.stdout || "（空输出）"}</pre>
								</div>
								<div>
									<small>运行信息</small>
									<pre>{item.stderr || `退出码 ${item.exitCode}`}</pre>
								</div>
							</div>
						</details>
					))}
					{currentReport.success && props.onApplyOutputs && (
						<button
							className="button secondary"
							type="button"
							onClick={() => {
								props.onApplyOutputs?.(
									cases.map((item, index) => ({
										input: item.input,
										output: currentReport.cases[index].stdout,
									})),
								);
								setMessage("标准输出已填入测试数据。");
							}}
						>
							将运行输出填入测试数据
						</button>
					)}
				</section>
			)}
		</div>
	);
}
