import type { ChangeEvent } from "react";
import type { AgentRun, ValidationReport, WorkflowStepPresentation } from "./platform.ts";
import { agentStatusLabel } from "./platform.ts";
import type { AttachmentDraft, ProblemDraft } from "./problem.ts";

interface Props {
	draft: ProblemDraft;
	viewingTask: boolean;
	attachments: AttachmentDraft[];
	validation?: ValidationReport;
	validationClass: string;
	agentClass: string;
	agentRun?: AgentRun;
	agentAvailable: boolean;
	algorithmValidation: WorkflowStepPresentation;
	liveHydroMessage: string;
	onFieldChange: (field: Exclude<keyof ProblemDraft, "cases">, value: string) => void;
	onInsertAttachment: (attachment: AttachmentDraft) => void;
	onRemoveAttachment: (name: string) => void;
	onUploadAttachments: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function WorkspaceSidebar(props: Props) {
	return (
		<aside className="sidebar">
			<section className="card side-card">
				<h2>{props.viewingTask ? "新题草稿信息" : "题目信息"}</h2>
				<label className="field">
					<span>题目名称</span>
					<input
						value={props.draft.title}
						placeholder="留空由 Agent 提取"
						onChange={(event) => props.onFieldChange("title", event.target.value)}
					/>
				</label>
				<label className="field">
					<span>目录标识</span>
					<input
						value={props.draft.slug}
						onChange={(event) => props.onFieldChange("slug", event.target.value)}
						spellCheck={false}
					/>
				</label>
				<label className="field">
					<span>标签</span>
					<input value={props.draft.tags} onChange={(event) => props.onFieldChange("tags", event.target.value)} />
				</label>
				<div className="field-row">
					<label className="field">
						<span>时间限制</span>
						<input
							value={props.draft.timeLimit}
							onChange={(event) => props.onFieldChange("timeLimit", event.target.value)}
						/>
					</label>
					<label className="field">
						<span>内存限制</span>
						<input
							value={props.draft.memoryLimit}
							onChange={(event) => props.onFieldChange("memoryLimit", event.target.value)}
						/>
					</label>
				</div>
			</section>

			<section className="card side-card">
				<div className="side-heading">
					<h2>附件</h2>
					<span>{props.attachments.length}</span>
				</div>
				{props.attachments.length === 0 && (
					<p className="muted">上传图片后，可将 `file://文件名` 引用插入题面或随 Agent 一同打包。</p>
				)}
				<ul className="attachment-list">
					{props.attachments.map((attachment) => (
						<li key={attachment.name}>
							<span title={attachment.name}>{attachment.name}</span>
							<div>
								<button type="button" onClick={() => props.onInsertAttachment(attachment)}>
									插入
								</button>
								<button
									className="danger"
									type="button"
									onClick={() => props.onRemoveAttachment(attachment.name)}
								>
									移除
								</button>
							</div>
						</li>
					))}
				</ul>
				<label className="upload-button">
					上传附件
					<input
						type="file"
						multiple
						accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf"
						onChange={props.onUploadAttachments}
					/>
				</label>
			</section>

			<section className="card side-card workflow-card">
				<h2>生成流程</h2>
				<ol className="workflow-list">
					<li className="done">
						<span>1</span>
						<div>
							<strong>整理题面</strong>
							<small>编辑器与预览已就绪</small>
						</div>
					</li>
					<li className={props.validationClass}>
						<span>2</span>
						<div>
							<strong>格式校验</strong>
							<small>{props.validation?.valid === true ? "检查通过" : "等待检查"}</small>
						</div>
					</li>
					<li className={props.agentClass}>
						<span>3</span>
						<div>
							<strong>Skill 整理与打包</strong>
							<small>
								{props.agentRun === undefined
									? props.agentAvailable
										? "等待运行"
										: "模型未配置"
									: agentStatusLabel(props.agentRun.status)}
							</small>
						</div>
					</li>
					<li className={props.algorithmValidation.className}>
						<span>4</span>
						<div>
							<strong>算法与数据验证</strong>
							<small>{props.algorithmValidation.message}</small>
						</div>
					</li>
					<li className={props.agentRun?.artifact?.liveVerification?.success ? "passed" : "pending"}>
						<span>5</span>
						<div>
							<strong>Hydro 实测</strong>
							<small>
								{props.agentRun?.artifact?.liveVerification?.success
									? "标程与错误程序验证通过"
									: props.liveHydroMessage}
							</small>
						</div>
					</li>
				</ol>
			</section>

			<section className="card side-card agent-card">
				<div className="agent-title">
					<span className="agent-glyph">π</span>
					<div>
						<strong className="agent-name">pi Skill</strong>
						<small className="agent-id">hydro-problem-authoring</small>
					</div>
				</div>
				<p>
					{props.agentAvailable
						? "模型已就绪，自动编写标程和 testlib 制题工程，必要时生成 C++ SPJ。无需预先上传程序。"
						: "在设置页配置 AI API 后，即可从题面创建制题任务。"}
				</p>
			</section>
		</aside>
	);
}
