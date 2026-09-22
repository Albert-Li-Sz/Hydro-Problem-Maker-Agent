import { useState } from "react";
import { type AgentRunSummary, agentStatusLabel, apiUrl, runDisplayTitle } from "./platform.ts";

export type RunsLoadStatus = "idle" | "loading" | "loaded" | "error";

interface RunsPageProps {
	apiOrigin: string;
	runs: readonly AgentRunSummary[];
	status: RunsLoadStatus;
	message: string;
	onRefresh: () => void;
	onOpenRun: (run: AgentRunSummary) => void;
	onDeleteRun: (run: AgentRunSummary) => void;
	deletingRunIds: readonly string[];
}

function statusClass(run: AgentRunSummary): string {
	if (run.status === "succeeded") return "passed";
	if (run.status === "failed" || run.status === "cancelled") return "failed";
	if (run.status === "needs_input") return "attention";
	return "active";
}

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

export function RunsPage(props: RunsPageProps) {
	const [runPendingDeletion, setRunPendingDeletion] = useState<AgentRunSummary>();
	return (
		<>
			<main className="page runs-page" id="runs">
				<div className="breadcrumb">任务 / 生成记录</div>
				<section className="page-heading">
					<div>
						<div className="eyebrow">pi Skill</div>
						<h1>任务记录</h1>
						<p>多条制题任务可同时运行；在这里继续任务，或直接下载已完成的题目包。</p>
					</div>
					<div className="heading-actions">
						<a className="button secondary button-link" href="#workspace">
							返回工作台
						</a>
						<button className="button primary" type="button" onClick={props.onRefresh}>
							{props.status === "loading" ? "刷新中…" : "刷新记录"}
						</button>
					</div>
				</section>

				{props.message && (
					<div className={`history-message ${props.status === "error" ? "failed" : ""}`}>{props.message}</div>
				)}
				{props.status !== "error" && props.runs.length === 0 && (
					<section className="card empty-history">
						<div className="empty-history-mark">π</div>
						<h2>{props.status === "loading" ? "正在读取任务记录" : "还没有生成任务"}</h2>
						<p>
							{props.status === "loading"
								? "正在从平台 API 获取任务状态。"
								: "在制题工作台运行 Pi Agent 后，任务会显示在这里，并保存在本地。"}
						</p>
						{props.status !== "loading" && (
							<a className="button primary button-link" href="#workspace">
								前往制题工作台
							</a>
						)}
					</section>
				)}

				{props.runs.length > 0 && (
					<section className="card history-card">
						<div className="history-summary">
							<span>共 {props.runs.length} 个任务</span>
							<small>任务、对话与生成包已保存在本地</small>
						</div>
						<div className="history-table-wrap">
							<table className="history-table">
								<thead>
									<tr>
										<th>题目</th>
										<th>状态</th>
										<th>模型</th>
										<th>更新时间</th>
										<th>操作</th>
									</tr>
								</thead>
								<tbody>
									{props.runs.map((run) => (
										<tr key={run.id}>
											<td>
												<strong>{runDisplayTitle(run)}</strong>
												<code title={run.id}>{run.id.slice(0, 12)}</code>
											</td>
											<td>
												<span className={`run-status ${statusClass(run)}`}>
													{agentStatusLabel(run.status)}
												</span>
											</td>
											<td>{run.model ?? "—"}</td>
											<td>{formatTimestamp(run.updatedAt)}</td>
											<td>
												<div className="history-actions">
													<button
														type="button"
														onClick={() => props.onOpenRun(run)}
														disabled={props.deletingRunIds.includes(run.id)}
													>
														{run.status === "needs_input" ? "补充并继续" : "查看详情"}
													</button>
													{run.status === "succeeded" && run.artifact !== undefined && (
														<a
															href={apiUrl(props.apiOrigin, `/runs/${run.id}/archive`)}
															download={`${run.artifact.slug}.hydro.zip`}
														>
															Hydro 包
														</a>
													)}
													{run.status === "succeeded" && run.artifact?.authoring !== undefined && (
														<a
															href={apiUrl(props.apiOrigin, `/runs/${run.id}/authoring`)}
															download={`${run.artifact.slug}.authoring.zip`}
														>
															制题工程
														</a>
													)}
													<button
														className="danger"
														type="button"
														disabled={
															run.status === "running" ||
															run.status === "queued" ||
															props.deletingRunIds.includes(run.id)
														}
														title={
															run.status === "running" || run.status === "queued"
																? "请先取消任务再删除"
																: "删除任务记录及其生成文件"
														}
														onClick={() => setRunPendingDeletion(run)}
													>
														{props.deletingRunIds.includes(run.id) ? "删除中…" : "删除"}
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				)}
			</main>
			{runPendingDeletion && (
				<div className="confirmation-backdrop">
					<section
						className="card confirmation-dialog"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="delete-run-title"
					>
						<div className="confirmation-heading">
							<span>删除任务</span>
							<h2 id="delete-run-title">确认删除“{runDisplayTitle(runPendingDeletion)}”？</h2>
						</div>
						<p>该任务的历史记录、Agent 会话和所有生成文件都会从本机删除，此操作无法撤销。</p>
						<code>{runPendingDeletion.id}</code>
						<div className="confirmation-actions">
							<button
								className="button secondary"
								type="button"
								onClick={() => setRunPendingDeletion(undefined)}
							>
								取消
							</button>
							<button
								className="button primary"
								type="button"
								onClick={() => {
									const run = runPendingDeletion;
									setRunPendingDeletion(undefined);
									props.onDeleteRun(run);
								}}
							>
								确认删除
							</button>
						</div>
					</section>
				</div>
			)}
		</>
	);
}
