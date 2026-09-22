import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type AgentRun, agentStatusLabel, apiUrl, isTerminalAgentRun } from "./platform.ts";

interface Props {
	run: AgentRun;
	apiOrigin: string;
	className: string;
	busy: boolean;
	available: boolean;
	hasReferenceProgram: boolean;
	message: string;
	onMessageChange: (message: string) => void;
	onContinue: (message: string) => Promise<boolean>;
	onCancel: () => void;
	onEditProgram: () => void;
}

export function AgentRunPanel(props: Props) {
	const { message, onMessageChange: setMessage } = props;
	const { run } = props;
	const canContinue = ["needs_input", "failed", "cancelled"].includes(run.status);
	return (
		<section className={`agent-run-panel ${props.className}`}>
			<div className="agent-run-heading">
				<div>
					<span>Pi Agent 任务</span>
					<strong>{agentStatusLabel(run.status)}</strong>
				</div>
				<code>{run.id}</code>
			</div>
			{(run.conversation?.length ?? 0) > 0 && (
				<details className="conversation-history">
					<summary>此前对话（{run.conversation?.length} 条）</summary>
					{run.conversation?.map((item, index) => (
						<div className="conversation-message" key={`${item.role}-${index}`}>
							<strong>{item.role === "user" ? "你的补充" : "Pi Agent"}</strong>
							<div className="agent-markdown">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
							</div>
						</div>
					))}
				</details>
			)}
			{run.assistantText && (
				<div className="agent-markdown current-reply">
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{run.assistantText}</ReactMarkdown>
				</div>
			)}
			{run.error && <p className="history-message failed">{run.error}</p>}
			{canContinue && (
				<form
					className="continue-form"
					onSubmit={(event) => {
						event.preventDefault();
						void props.onContinue(message).then((ok) => {
							if (ok) setMessage("");
						});
					}}
				>
					<label htmlFor="agent-clarification">补充信息，继续当前任务</label>
					<p>补充题意或要求 Agent 修正后重试。标程可由 Agent 自动生成，原题面和此前对话会保留。</p>
					<textarea
						id="agent-clarification"
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						placeholder="例如：以题面为准，自动修正标程并完成 testlib 数据生成、校验和对拍。"
						disabled={props.busy}
					/>
					<div className="continue-options">
						<button
							className="text-button"
							type="button"
							onClick={() =>
								setMessage(
									"以当前题面为准。忽略不属于本题的旧程序、元数据或样例，自动编写正确标程、独立对拍程序、testlib 生成器与输入校验器；必要时生成 C++ testlib SPJ。运行完整验证，修复失败项后打包，无需我再上传程序。",
								)
							}
						>
							填写“以题面为准”
						</button>
						<button className="text-button" type="button" onClick={props.onEditProgram}>
							{props.hasReferenceProgram ? "已附加标准程序 · 编辑" : "添加标准程序"}
						</button>
					</div>
					<button
						className="button primary"
						type="submit"
						disabled={!message.trim() || props.busy || !props.available}
					>
						{props.busy ? "提交中…" : "提交补充并继续"}
					</button>
					{!props.available && (
						<p>
							<a href="#settings">配置 AI API</a> 后即可继续。
						</p>
					)}
				</form>
			)}
			<div className="agent-run-actions">
				{run.artifact?.authoring && (
					<a
						href={apiUrl(props.apiOrigin, `/runs/${run.id}/authoring`)}
						download={`${run.artifact.slug}.authoring.zip`}
					>
						下载制题工程（标程 / testlib / SPJ）
					</a>
				)}
				{!isTerminalAgentRun(run.status) && (
					<button type="button" onClick={props.onCancel}>
						取消任务
					</button>
				)}
				{run.status === "succeeded" && run.artifact && (
					<a href={apiUrl(props.apiOrigin, `/runs/${run.id}/archive`)} download={`${run.artifact.slug}.hydro.zip`}>
						下载 Hydro 包
					</a>
				)}
			</div>
			{run.artifact?.authoring && (
				<section className="sandbox-results">
					<strong>testlib 制题验证通过</strong>
					<p>
						{run.artifact.authoring.testCases} 个测试点 · {run.artifact.authoring.generatedCases} 个生成点 ·{" "}
						{run.artifact.authoring.oracleCases} 次独立对拍 · {run.artifact.authoring.validatorNegativeCases}{" "}
						个非法输入已拒绝 · {run.artifact.authoring.wrongPrograms} 个错误程序已检出
					</p>
					<p>
						{run.artifact.authoring.checker === "testlib"
							? `C++ testlib SPJ · ${run.artifact.authoring.checkerProbes} 个判定探针通过`
							: "Hydro 默认比较器"}
					</p>
					<details>
						<summary>查看执行记录</summary>
						{run.artifact.authoring.checks.map((check, index) => (
							<div key={`${check.stage}-${index}`}>
								{check.passed ? "✓" : "!"} {check.stage}
								{check.caseId ? ` · ${check.caseId}` : ""}
								<pre>{check.message}</pre>
							</div>
						))}
					</details>
				</section>
			)}
		</section>
	);
}
