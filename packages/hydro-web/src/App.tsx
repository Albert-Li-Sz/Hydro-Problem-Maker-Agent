import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { AgentRunPanel } from "./AgentRunPanel.tsx";
import {
	type AgentRun,
	type AgentRunStatus,
	type ApiStatus,
	agentStatusLabel,
	algorithmValidationPresentation,
	apiStatusLabel,
	apiUrl,
	isTerminalAgentRun,
	normalizeApiOrigin,
	pageFromHash,
	type ReferenceProgram,
	readAgentRun,
	readAgentRunList,
	runDisplayTitle,
	type SandboxStatus,
	type ValidationReport,
} from "./platform.ts";
import {
	type AttachmentDraft,
	type CaseDraft,
	createAgentSource,
	createProblemRequest,
	emptyDraft,
	type ProblemDraft,
	samplesFromAgentSource,
	statementWithSamples,
} from "./problem.ts";
import { ReferenceProgramEditor } from "./ReferenceProgramEditor.tsx";
import { type RunsLoadStatus, RunsPage } from "./RunsPage.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

type WorkspaceTab = "statement" | "tests" | "reference" | "validation";
type BusyAction = "validate" | "download" | "agent" | "continue" | undefined;

const apiOriginStorageKey = "hydro-problem-make.api-origin";

const exampleDraft: ProblemDraft = {
	slug: "a-plus-b",
	title: "A + B",
	tags: "入门, 模拟",
	timeLimit: "1s",
	memoryLimit: "256m",
	statement: `# A + B

## 题目描述

给定两个整数 $a$ 和 $b$，计算它们的和。

## 输入格式

一行两个整数 $a,b$，满足 $-10^9 \\le a,b \\le 10^9$。

## 输出格式

输出一个整数，表示 $a+b$。`,
	cases: [
		{ input: "1 2", output: "3" },
		{ input: "-5 8", output: "3" },
	],
};

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result === "string") resolve(reader.result);
			else reject(new Error(`无法读取附件 ${file.name}`));
		});
		reader.addEventListener("error", () => reject(reader.error ?? new Error(`无法读取附件 ${file.name}`)));
		reader.readAsDataURL(file);
	});
}

function errorMessage(value: unknown): string {
	if (typeof value !== "object" || value === null) return "请求失败，请检查 API 服务。";
	const message = (value as Record<string, unknown>).message;
	return typeof message === "string" ? message : "请求失败，请检查题目信息。";
}

function validationReport(value: unknown): ValidationReport | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const report = (value as Record<string, unknown>).report;
	if (typeof report !== "object" || report === null) return undefined;
	const valid = (report as Record<string, unknown>).valid;
	const issues = (report as Record<string, unknown>).issues;
	if (typeof valid !== "boolean" || !Array.isArray(issues)) return undefined;
	return report as ValidationReport;
}

function storedApiOrigin(): string {
	try {
		return normalizeApiOrigin(localStorage.getItem(apiOriginStorageKey) ?? "");
	} catch {
		localStorage.removeItem(apiOriginStorageKey);
		return "";
	}
}

export function App() {
	const [page, setPage] = useState(() => pageFromHash(window.location.hash));
	const [draft, setDraft] = useState(emptyDraft);
	const [referenceProgram, setReferenceProgram] = useState<ReferenceProgram>({ language: "cpp17", code: "" });
	const [taskReferenceProgram, setTaskReferenceProgram] = useState<ReferenceProgram>({ language: "cpp17", code: "" });
	const [editingTaskProgram, setEditingTaskProgram] = useState(false);
	const [sandbox, setSandbox] = useState<SandboxStatus>();
	const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
	const [activeTab, setActiveTab] = useState<WorkspaceTab>("statement");
	const [apiOrigin, setApiOrigin] = useState(storedApiOrigin);
	const [apiOriginDraft, setApiOriginDraft] = useState(apiOrigin);
	const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
	const [agentAvailable, setAgentAvailable] = useState(false);
	const [agentModels, setAgentModels] = useState<string[]>([]);
	const [connectionMessage, setConnectionMessage] = useState("正在连接平台 API……");
	const [agentRun, setAgentRun] = useState<AgentRun>();
	const [continuationDrafts, setContinuationDrafts] = useState<Record<string, string>>({});
	const [runs, setRuns] = useState<AgentRun[]>([]);
	const [runsStatus, setRunsStatus] = useState<RunsLoadStatus>("idle");
	const [runsMessage, setRunsMessage] = useState("");
	const [deletingRunIds, setDeletingRunIds] = useState<string[]>([]);
	const deletedRunIds = useRef(new Set<string>());
	const [validation, setValidation] = useState<ValidationReport>();
	const [busyAction, setBusyAction] = useState<BusyAction>();
	const [notice, setNotice] = useState("粘贴题面即可运行 Pi Agent，自动生成标程、testlib 数据与需要的 SPJ。");
	const eventSourceRef = useRef<EventSource | undefined>(undefined);
	const workspaceRevision = useRef(0);
	const checkApiConnection = useCallback(async (origin: string, signal?: AbortSignal): Promise<void> => {
		setApiStatus("checking");
		setAgentAvailable(false);
		setAgentModels([]);
		setSandbox(undefined);
		setConnectionMessage("正在连接平台 API……");
		try {
			const response = await fetch(apiUrl(origin, "/health"), { signal });
			if (!response.ok) throw new Error("API health check failed");
			const body = (await response.json()) as unknown;
			setApiStatus("online");
			setConnectionMessage("连接成功，格式检查与打包 API 可用。");
			if (typeof body !== "object" || body === null) return;
			const sandboxStatus = (body as { sandbox?: SandboxStatus }).sandbox;
			if (sandboxStatus) setSandbox(sandboxStatus);
			const capabilities = (body as Record<string, unknown>).capabilities;
			if (typeof capabilities !== "object" || capabilities === null) return;
			const values = capabilities as Record<string, unknown>;
			setAgentAvailable(values.agentGeneration === true);
			if (Array.isArray(values.agentModels)) {
				setAgentModels(values.agentModels.filter((model): model is string => typeof model === "string"));
			}
		} catch (error) {
			if (signal?.aborted) return;
			setApiStatus("offline");
			setConnectionMessage(error instanceof Error ? `连接失败：${error.message}` : "连接失败，请检查 API 地址。");
		}
	}, []);
	const loadRuns = useCallback(async (): Promise<void> => {
		setRunsStatus("loading");
		setRunsMessage("");
		try {
			const response = await fetch(apiUrl(apiOrigin, "/runs"));
			const body = (await response.json()) as unknown;
			if (!response.ok) throw new Error(errorMessage(body));
			if (typeof body !== "object" || body === null || !Array.isArray((body as Record<string, unknown>).runs)) {
				throw new Error("服务端返回了无法识别的任务列表。");
			}
			setRuns(readAgentRunList(body).filter((run) => !deletedRunIds.current.has(run.id)));
			setRunsStatus("loaded");
		} catch (error) {
			setRunsStatus("error");
			setRunsMessage(error instanceof Error ? error.message : "任务记录读取失败。");
		}
	}, [apiOrigin]);

	useEffect(() => {
		const updatePage = (): void => setPage(pageFromHash(window.location.hash));
		window.addEventListener("hashchange", updatePage);
		return () => window.removeEventListener("hashchange", updatePage);
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		void checkApiConnection(apiOrigin, controller.signal);
		return () => controller.abort();
	}, [apiOrigin, checkApiConnection]);

	useEffect(() => () => eventSourceRef.current?.close(), []);

	useEffect(() => {
		if (page === "runs") void loadRuns();
	}, [loadRuns, page]);

	const previewStatement = useMemo(() => {
		let markdown = statementWithSamples(draft);
		for (const attachment of attachments)
			markdown = markdown.replaceAll(`file://${attachment.name}`, attachment.dataUrl);
		return markdown;
	}, [attachments, draft]);

	function invalidateValidation(): void {
		setValidation(undefined);
		setNotice("内容已修改，需要重新运行格式检查。");
	}

	function resetWorkspace(): void {
		workspaceRevision.current += 1;
		eventSourceRef.current?.close();
		eventSourceRef.current = undefined;
		setDraft({ ...emptyDraft, cases: [] });
		setReferenceProgram({ language: "cpp17", code: "" });
		setTaskReferenceProgram({ language: "cpp17", code: "" });
		setEditingTaskProgram(false);
		setAttachments([]);
		setAgentRun(undefined);
		setValidation(undefined);
		setBusyAction(undefined);
		setActiveTab("statement");
		setNotice("已重制，可以粘贴下一题。已创建的任务保留在任务记录中。");
		window.location.hash = "workspace";
	}

	function updateField(field: Exclude<keyof ProblemDraft, "cases">, value: string): void {
		setDraft((current) => ({ ...current, [field]: value }));
		invalidateValidation();
	}

	function updateCase(index: number, field: keyof CaseDraft, value: string): void {
		setDraft((current) => ({
			...current,
			cases: current.cases.map((testCase, caseIndex) =>
				caseIndex === index ? { ...testCase, [field]: value } : testCase,
			),
		}));
		invalidateValidation();
	}

	async function runValidation(): Promise<void> {
		const revision = workspaceRevision.current;
		setBusyAction("validate");
		setNotice("正在检查 Hydro 元数据、题面、样例和测试配置……");
		try {
			const response = await fetch(apiUrl(apiOrigin, "/problems/validate"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(createProblemRequest(draft, attachments)),
			});
			const body = (await response.json()) as unknown;
			if (revision !== workspaceRevision.current) return;
			if (!response.ok) throw new Error(errorMessage(body));
			const report = body as ValidationReport;
			setValidation(report);
			setNotice(
				report.valid ? "格式检查通过，可以生成 Hydro 导入包。" : `发现 ${report.issues.length} 个格式问题。`,
			);
			if (!report.valid) setActiveTab("validation");
		} catch (error) {
			if (revision !== workspaceRevision.current) return;
			setNotice(error instanceof Error ? error.message : "格式检查失败。");
		} finally {
			if (revision === workspaceRevision.current) setBusyAction(undefined);
		}
	}

	async function downloadArchive(): Promise<void> {
		const revision = workspaceRevision.current;
		setBusyAction("download");
		setNotice("正在生成可复现的 Hydro 导入包……");
		try {
			const response = await fetch(apiUrl(apiOrigin, "/problems/archive"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(createProblemRequest(draft, attachments)),
			});
			if (!response.ok) {
				const body = (await response.json()) as unknown;
				if (revision !== workspaceRevision.current) return;
				const report = validationReport(body);
				if (report !== undefined) {
					setValidation(report);
					setActiveTab("validation");
				}
				throw new Error(errorMessage(body));
			}
			const archive = await response.blob();
			if (revision !== workspaceRevision.current) return;
			const url = URL.createObjectURL(archive);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${draft.slug}.hydro.zip`;
			link.click();
			URL.revokeObjectURL(url);
			setValidation({ valid: true, issues: [] });
			setNotice("Hydro 导入包已生成。该结果尚未完成算法正确性和真实 Hydro 评测验收。");
		} catch (error) {
			if (revision !== workspaceRevision.current) return;
			setNotice(error instanceof Error ? error.message : "导入包生成失败。");
		} finally {
			if (revision === workspaceRevision.current) setBusyAction(undefined);
		}
	}

	async function refreshAgentRun(runId: string, revision: number): Promise<AgentRun | undefined> {
		const response = await fetch(apiUrl(apiOrigin, `/runs/${runId}`));
		if (!response.ok) return undefined;
		const run = readAgentRun((await response.json()) as unknown);
		if (run === undefined || deletedRunIds.current.has(run.id)) return undefined;
		setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
		if (revision !== workspaceRevision.current) return undefined;
		setAgentRun(run);
		if (run.artifact !== undefined) setValidation(run.artifact.report);
		if (run.status === "succeeded") setNotice("Skill 已生成并校验 Hydro 目录，可以下载对应导入包。");
		else if (run.status === "needs_input") setNotice("请在任务对话下方填写补充信息，然后点击“提交补充并继续”。");
		else if (run.status === "failed") setNotice("Skill 生成失败，请查看验证记录。");
		else if (run.status === "cancelled") setNotice("Skill 生成任务已取消。");
		return run;
	}

	function watchAgentRun(run: AgentRun): void {
		const revision = workspaceRevision.current;
		const runId = run.id;
		eventSourceRef.current?.close();
		eventSourceRef.current = undefined;
		if (isTerminalAgentRun(run.status)) return;
		const source = new EventSource(apiUrl(apiOrigin, `/runs/${runId}/events?after=${run.lastEventSequence ?? 0}`));
		eventSourceRef.current = source;
		const isCurrent = (): boolean => revision === workspaceRevision.current && eventSourceRef.current === source;
		source.addEventListener("text_delta", (event) => {
			if (!isCurrent()) return;
			if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
			try {
				const data = JSON.parse(event.data) as unknown;
				if (typeof data !== "object" || data === null) return;
				const delta = (data as Record<string, unknown>).message;
				if (typeof delta === "string") {
					setAgentRun((current) =>
						current?.id === runId ? { ...current, assistantText: `${current.assistantText}${delta}` } : current,
					);
				}
			} catch {
				// Ignore an incomplete event and let the final snapshot replace it.
			}
		});
		source.addEventListener("tool", (event) => {
			if (!isCurrent()) return;
			if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
			try {
				const data = JSON.parse(event.data) as unknown;
				if (typeof data !== "object" || data === null) return;
				const message = (data as Record<string, unknown>).message;
				if (typeof message === "string") setNotice(message);
			} catch {
				// Ignore malformed progress; the run snapshot remains authoritative.
			}
		});
		source.addEventListener("status", (event) => {
			if (!isCurrent()) return;
			if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
			try {
				const data = JSON.parse(event.data) as unknown;
				if (typeof data !== "object" || data === null) return;
				const status = (data as Record<string, unknown>).status;
				if (status === "queued" || status === "running")
					setAgentRun((current) => (current?.id === runId ? { ...current, status } : current));
				if (typeof status === "string" && isTerminalAgentRun(status as AgentRunStatus)) {
					source.close();
					void refreshAgentRun(runId, revision).catch(() => {
						if (isCurrent()) setNotice("任务状态读取失败，请从任务记录重新打开。");
					});
				}
			} catch {
				// Ignore malformed progress; the run snapshot remains authoritative.
			}
		});
		source.onerror = () => {
			source.close();
			if (!isCurrent()) return;
			void refreshAgentRun(runId, revision)
				.then((current) => {
					if (current && isCurrent()) watchAgentRun(current);
				})
				.catch(() => {
					if (isCurrent()) setNotice("任务连接中断，请从任务记录重新打开。");
				});
		};
	}

	async function startAgentRun(): Promise<void> {
		if (!draft.statement.trim()) {
			setNotice("请先粘贴题面。");
			return;
		}
		if (!agentAvailable) {
			setNotice("服务端尚未配置可用的 Pi 模型。");
			return;
		}
		if (attachments.length > 0) {
			setNotice("当前 Skill 运行接口暂不接收二进制附件；请先用无附件题面运行，或使用确定性打包。");
			return;
		}
		workspaceRevision.current += 1;
		const revision = workspaceRevision.current;
		eventSourceRef.current?.close();
		eventSourceRef.current = undefined;
		setBusyAction("agent");
		setNotice("正在创建 Skill 生成任务……");
		try {
			const response = await fetch(apiUrl(apiOrigin, "/runs"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					source: createAgentSource(draft),
					referenceProgram: referenceProgram.code.trim() ? referenceProgram : undefined,
				}),
			});
			const body = (await response.json()) as unknown;
			if (!response.ok) throw new Error(errorMessage(body));
			const run = readAgentRun(body);
			if (run === undefined) throw new Error("服务端返回了无法识别的任务状态。");
			setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
			if (revision !== workspaceRevision.current) return;
			setAgentRun(run);
			setTaskReferenceProgram(run.referenceProgram ?? referenceProgram);
			setValidation(undefined);
			setActiveTab("validation");
			setNotice("Skill 任务已创建，进度会实时显示在验证记录中。");
			watchAgentRun(run);
		} catch (error) {
			if (revision !== workspaceRevision.current) return;
			setNotice(error instanceof Error ? error.message : "Skill 任务创建失败。");
		} finally {
			if (revision === workspaceRevision.current) setBusyAction(undefined);
		}
	}

	async function continueAgentRun(message: string): Promise<boolean> {
		if (!agentRun) return false;
		workspaceRevision.current += 1;
		const revision = workspaceRevision.current;
		eventSourceRef.current?.close();
		eventSourceRef.current = undefined;
		setBusyAction("continue");
		try {
			const response = await fetch(apiUrl(apiOrigin, `/runs/${agentRun.id}/continue`), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					message,
					referenceProgram: taskReferenceProgram.code.trim() ? taskReferenceProgram : null,
				}),
			});
			const body = (await response.json()) as unknown;
			if (!response.ok) throw new Error(errorMessage(body));
			const run = readAgentRun(body);
			if (!run) throw new Error("无法读取续接任务状态。");
			setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
			if (revision !== workspaceRevision.current) return true;
			setAgentRun(run);
			setValidation(undefined);
			setNotice("已提交补充信息，Pi Agent 正在继续当前任务。");
			watchAgentRun(run);
			return true;
		} catch (error) {
			if (revision !== workspaceRevision.current) return false;
			setNotice(error instanceof Error ? error.message : "继续任务失败。");
			return false;
		} finally {
			if (revision === workspaceRevision.current) setBusyAction(undefined);
		}
	}

	async function cancelAgentRun(): Promise<void> {
		if (agentRun === undefined) return;
		const revision = workspaceRevision.current;
		try {
			const response = await fetch(apiUrl(apiOrigin, `/runs/${agentRun.id}/cancel`), { method: "POST" });
			if (!response.ok) throw new Error(errorMessage((await response.json()) as unknown));
			if (revision !== workspaceRevision.current) return;
			eventSourceRef.current?.close();
			eventSourceRef.current = undefined;
			await refreshAgentRun(agentRun.id, revision);
		} catch (error) {
			if (revision === workspaceRevision.current)
				setNotice(error instanceof Error ? error.message : "取消任务失败。");
		}
	}

	function saveApiConfiguration(): void {
		try {
			const normalized = normalizeApiOrigin(apiOriginDraft);
			if (normalized.length > 0) localStorage.setItem(apiOriginStorageKey, normalized);
			else localStorage.removeItem(apiOriginStorageKey);
			setApiOriginDraft(normalized);
			if (normalized === apiOrigin) void checkApiConnection(normalized);
			else setApiOrigin(normalized);
		} catch (error) {
			setApiStatus("offline");
			setConnectionMessage(error instanceof Error ? error.message : "API 根地址无效。");
		}
	}

	function resetApiConfiguration(): void {
		localStorage.removeItem(apiOriginStorageKey);
		setApiOriginDraft("");
		if (apiOrigin.length === 0) void checkApiConnection("");
		else setApiOrigin("");
	}

	async function openHistoryRun(previousRun: AgentRun): Promise<void> {
		workspaceRevision.current += 1;
		const revision = workspaceRevision.current;
		eventSourceRef.current?.close();
		eventSourceRef.current = undefined;
		setBusyAction(undefined);
		let run: AgentRun;
		try {
			run = (await refreshAgentRun(previousRun.id, revision)) ?? previousRun;
		} catch {
			run = previousRun;
		}
		if (revision !== workspaceRevision.current || deletedRunIds.current.has(previousRun.id)) return;
		setAgentRun(run);
		setTaskReferenceProgram(run.referenceProgram ?? { language: "cpp17", code: "" });
		setValidation(run.artifact?.report);
		setActiveTab("validation");
		setNotice(`已打开任务 ${run.id.slice(0, 8)}：${agentStatusLabel(run.status)}。`);
		window.location.hash = "workspace";
		watchAgentRun(run);
	}

	async function deleteRun(run: AgentRun): Promise<void> {
		const revision = workspaceRevision.current;
		setDeletingRunIds((current) => [...current, run.id]);
		setRunsMessage("");
		try {
			const response = await fetch(apiUrl(apiOrigin, `/runs/${run.id}`), { method: "DELETE" });
			if (!response.ok) throw new Error(errorMessage((await response.json()) as unknown));
			deletedRunIds.current.add(run.id);
			setRuns((current) => current.filter((item) => item.id !== run.id));
			setContinuationDrafts((current) => {
				const remaining = { ...current };
				delete remaining[run.id];
				return remaining;
			});
			setRunsStatus("loaded");
			setRunsMessage(`已删除任务“${runDisplayTitle(run)}”。`);
			if (revision === workspaceRevision.current && agentRun?.id === run.id) {
				workspaceRevision.current += 1;
				eventSourceRef.current?.close();
				eventSourceRef.current = undefined;
				setAgentRun(undefined);
				setTaskReferenceProgram({ language: "cpp17", code: "" });
				setEditingTaskProgram(false);
				setValidation(undefined);
				setBusyAction(undefined);
				setActiveTab("statement");
				setNotice("任务已删除，当前题面草稿已保留。");
			}
		} catch (error) {
			setRunsStatus("error");
			setRunsMessage(error instanceof Error ? error.message : "删除任务失败，请重试。");
		} finally {
			setDeletingRunIds((current) => current.filter((id) => id !== run.id));
		}
	}

	async function addAttachments(event: ChangeEvent<HTMLInputElement>): Promise<void> {
		const revision = workspaceRevision.current;
		const input = event.currentTarget;
		const files = [...(input.files ?? [])];
		try {
			const additions: AttachmentDraft[] = [];
			for (const file of files) {
				if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.name)) {
					throw new Error(`附件名 ${file.name} 只能使用 ASCII 字母、数字、点、横线和下划线。`);
				}
				if (file.size > 1024 * 1024) throw new Error(`附件 ${file.name} 超过当前 1 MiB 限制。`);
				const dataUrl = await readFileAsDataUrl(file);
				additions.push({ name: file.name, contentBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), dataUrl });
			}
			if (revision !== workspaceRevision.current) return;
			setAttachments((current) => {
				const names = new Set(additions.map((attachment) => attachment.name));
				return [...current.filter((attachment) => !names.has(attachment.name)), ...additions];
			});
			invalidateValidation();
		} catch (error) {
			if (revision !== workspaceRevision.current) return;
			setNotice(error instanceof Error ? error.message : "附件读取失败。");
		} finally {
			input.value = "";
		}
	}

	function insertAttachment(attachment: AttachmentDraft): void {
		const isImage = attachment.dataUrl.startsWith("data:image/");
		const reference = isImage
			? `\n\n![${attachment.name}](file://${attachment.name})`
			: `\n\n[${attachment.name}](file://${attachment.name})`;
		updateField("statement", `${draft.statement.trimEnd()}${reference}\n`);
	}

	const validationClass = validation === undefined ? "pending" : validation.valid ? "passed" : "failed";
	const viewingTask = agentRun && (activeTab === "validation" || (activeTab === "reference" && editingTaskProgram));
	const agentRunning = agentRun?.status === "queued" || agentRun?.status === "running";
	const agentClass =
		agentRun?.status === "succeeded"
			? "passed"
			: agentRun?.status === "failed" || agentRun?.status === "cancelled"
				? "failed"
				: agentRun?.status === "needs_input"
					? "attention"
					: agentRunning
						? "active"
						: "pending";
	const algorithmValidation = algorithmValidationPresentation(agentRun, sandbox);

	return (
		<>
			<header className="site-header">
				<div className="header-inner">
					<a className="brand" href="#workspace" aria-label="Hydro Problem Make 首页">
						<span className="brand-mark">H</span>
						<span>Hydro Problem Make</span>
					</a>
					<nav className="main-nav" aria-label="主导航">
						<a className={page === "workspace" ? "active" : ""} href="#workspace">
							制题工作台
						</a>
						<a className={page === "runs" ? "active" : ""} href="#runs">
							任务记录
						</a>
						<a className={page === "settings" ? "active" : ""} href="#settings">
							设置
						</a>
					</nav>
					<button
						className={`api-pill ${apiStatus}`}
						type="button"
						onClick={() => {
							window.location.hash = "settings";
						}}
						title="打开 API 配置"
					>
						{apiStatusLabel(apiStatus)}
					</button>
				</div>
			</header>

			{page === "workspace" && (
				<main className="page" id="workspace">
					<div className="breadcrumb">
						{viewingTask
							? `任务记录 / ${runDisplayTitle(agentRun)}`
							: `题库 / 新建题目 / ${draft.title || "未命名题目"}`}
					</div>
					<section className="page-heading">
						<div>
							<div className="eyebrow">自动制题 · testlib · Hydro</div>
							<h1>{viewingTask ? runDisplayTitle(agentRun) : draft.title || "未命名题目"}</h1>
							<p>粘贴题面，自动生成标程、测试数据与需要的 SPJ，验证后下载 Hydro 包。</p>
						</div>
						<div className="heading-actions">
							<button className="button secondary" type="button" onClick={resetWorkspace}>
								重制 / 下一题
							</button>
							<button
								className="button primary"
								type="button"
								onClick={startAgentRun}
								disabled={!agentAvailable || busyAction !== undefined || agentRunning}
								title={
									agentAvailable
										? "使用固定 Hydro Skill 创建 Pi Agent 任务"
										: "请先在设置页配置 Pi Agent 的 AI API"
								}
							>
								{busyAction === "agent" ? "创建中…" : agentAvailable ? "运行 Pi Agent" : "AI 生成未配置"}
							</button>
							<button
								className="button secondary"
								type="button"
								onClick={runValidation}
								disabled={busyAction !== undefined}
							>
								{busyAction === "validate" ? "检查中…" : "运行格式检查"}
							</button>
							{activeTab === "validation" && agentRun?.status === "succeeded" && agentRun.artifact ? (
								<a
									className="button primary button-link"
									href={apiUrl(apiOrigin, `/runs/${agentRun.id}/archive`)}
									download={`${agentRun.artifact.slug}.hydro.zip`}
								>
									下载 Hydro 包
								</a>
							) : (
								<button
									className="button secondary"
									type="button"
									onClick={downloadArchive}
									disabled={busyAction !== undefined}
								>
									{busyAction === "download" ? "生成中…" : "手工打包"}
								</button>
							)}
						</div>
					</section>

					<output className={`notice ${validationClass}`}>
						<span className="notice-dot" />
						{notice}
					</output>

					<div className="workspace-grid">
						<section className="card workspace-card">
							<div className="tabs" role="tablist" aria-label="题目内容">
								<button
									className={activeTab === "statement" ? "active" : ""}
									type="button"
									onClick={() => setActiveTab("statement")}
								>
									题面与预览
								</button>
								<button
									className={activeTab === "tests" ? "active" : ""}
									type="button"
									onClick={() => setActiveTab("tests")}
								>
									测试数据 <span className="tab-count">{draft.cases.length}</span>
								</button>
								<button
									className={activeTab === "reference" ? "active" : ""}
									type="button"
									onClick={() => {
										setEditingTaskProgram(false);
										setActiveTab("reference");
									}}
								>
									标准程序{referenceProgram.code.trim() && <span className="tab-count">1</span>}
								</button>
								<button
									className={activeTab === "validation" ? "active" : ""}
									type="button"
									onClick={() => setActiveTab("validation")}
								>
									任务与验证
								</button>
							</div>

							{activeTab === "statement" && (
								<div className="editor-grid">
									<div className="editor-pane">
										<div className="pane-heading">
											<strong>Markdown 题面</strong>
											{!draft.statement.trim() ? (
												<button
													className="text-button"
													type="button"
													onClick={() => {
														setDraft(exampleDraft);
														invalidateValidation();
													}}
												>
													载入 A+B 示例
												</button>
											) : (
												<span>样例由测试数据自动附加</span>
											)}
										</div>
										<textarea
											className="statement-editor"
											value={draft.statement}
											onChange={(event) => updateField("statement", event.target.value)}
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
												{previewStatement}
											</ReactMarkdown>
										</article>
									</div>
								</div>
							)}

							{activeTab === "tests" && (
								<div className="tab-body">
									<div className="info-strip">
										当前测试点会组成一个 100 分逐点计分子任务。它们是已有材料，不代表已经覆盖边界或通过对拍。
									</div>
									<div className="test-list">
										{draft.cases.map((testCase, index) => (
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
															onChange={(event) => updateCase(index, "input", event.target.value)}
														/>
													</label>
													<label>
														<span>标准输出</span>
														<textarea
															value={testCase.output}
															onChange={(event) => updateCase(index, "output", event.target.value)}
														/>
													</label>
												</div>
												<button
													className="text-button danger"
													type="button"
													onClick={() => {
														setDraft((current) => ({
															...current,
															cases: current.cases.filter((_, caseIndex) => caseIndex !== index),
														}));
														invalidateValidation();
													}}
												>
													删除测试点
												</button>
											</div>
										))}
									</div>
									<button
										className="button secondary"
										type="button"
										onClick={() => {
											setDraft((current) => ({
												...current,
												cases: [...current.cases, { input: "", output: "" }],
											}));
											invalidateValidation();
										}}
									>
										添加测试点
									</button>
								</div>
							)}

							{activeTab === "validation" && (
								<div className="tab-body validation-body">
									{agentRun && (
										<AgentRunPanel
											key={agentRun.id}
											run={agentRun}
											apiOrigin={apiOrigin}
											className={agentClass}
											busy={busyAction !== undefined}
											available={agentAvailable}
											hasReferenceProgram={!!taskReferenceProgram.code.trim()}
											message={continuationDrafts[agentRun.id] ?? ""}
											onMessageChange={(message) =>
												setContinuationDrafts((current) => ({ ...current, [agentRun.id]: message }))
											}
											onContinue={continueAgentRun}
											onCancel={() => void cancelAgentRun()}
											onEditProgram={() => {
												setEditingTaskProgram(true);
												setActiveTab("reference");
											}}
										/>
									)}
									<div className={`validation-summary ${validationClass}`}>
										<div className="summary-icon">
											{validation?.valid === true ? "✓" : validation === undefined ? "…" : "!"}
										</div>
										<div>
											<strong>
												{validation?.valid === true
													? "Hydro 格式检查通过"
													: validation === undefined
														? "尚未运行格式检查"
														: "Hydro 格式检查未通过"}
											</strong>
											<p>该检查覆盖包结构、文件引用、限制单位、计分与比较器配置。</p>
										</div>
									</div>
									{validation !== undefined && validation.issues.length > 0 && (
										<table className="issues-table">
											<thead>
												<tr>
													<th>位置</th>
													<th>代码</th>
													<th>说明</th>
												</tr>
											</thead>
											<tbody>
												{validation.issues.map((issue, index) => (
													<tr key={`${issue.code}-${issue.path}-${index}`}>
														<td>{issue.path}</td>
														<td>
															<code>{issue.code}</code>
														</td>
														<td>{issue.message}</td>
													</tr>
												))}
											</tbody>
										</table>
									)}
									<div className="evidence-grid">
										<div>
											<span>格式与目录</span>
											<strong>{validation?.valid === true ? "通过" : "待检查"}</strong>
										</div>
										<div>
											<span>标准程序校验</span>
											<strong>
												{agentRun?.artifact?.verification?.success
													? `${agentRun.artifact.verification.cases.length} 个测试点通过`
													: "未执行"}
											</strong>
										</div>
										<div>
											<span>真实 Hydro 导入</span>
											<strong>未执行</strong>
										</div>
									</div>
								</div>
							)}
							{activeTab === "reference" && (
								<ReferenceProgramEditor
									key={editingTaskProgram ? agentRun?.id : "draft"}
									apiOrigin={apiOrigin}
									program={editingTaskProgram ? taskReferenceProgram : referenceProgram}
									onChange={editingTaskProgram ? setTaskReferenceProgram : setReferenceProgram}
									cases={
										editingTaskProgram && agentRun ? samplesFromAgentSource(agentRun.source) : draft.cases
									}
									timeLimit={
										editingTaskProgram
											? (agentRun?.source.match(/^- 时间限制：(.+)$/m)?.[1] ?? "1s")
											: draft.timeLimit
									}
									memoryLimit={
										editingTaskProgram
											? (agentRun?.source.match(/^- 内存限制：(.+)$/m)?.[1] ?? "256m")
											: draft.memoryLimit
									}
									sandbox={sandbox}
									onApplyOutputs={
										editingTaskProgram
											? undefined
											: (cases) => {
													setDraft((current) => ({ ...current, cases }));
													invalidateValidation();
												}
									}
									hasTask={editingTaskProgram && !!agentRun}
									onBackToTask={() => setActiveTab("validation")}
								/>
							)}
						</section>

						<aside className="sidebar">
							<section className="card side-card">
								<h2>{viewingTask ? "新题草稿信息" : "题目信息"}</h2>
								<label className="field">
									<span>题目名称</span>
									<input
										value={draft.title}
										placeholder="留空由 Agent 提取"
										onChange={(event) => updateField("title", event.target.value)}
									/>
								</label>
								<label className="field">
									<span>目录标识</span>
									<input
										value={draft.slug}
										onChange={(event) => updateField("slug", event.target.value)}
										spellCheck={false}
									/>
								</label>
								<label className="field">
									<span>标签</span>
									<input value={draft.tags} onChange={(event) => updateField("tags", event.target.value)} />
								</label>
								<div className="field-row">
									<label className="field">
										<span>时间限制</span>
										<input
											value={draft.timeLimit}
											onChange={(event) => updateField("timeLimit", event.target.value)}
										/>
									</label>
									<label className="field">
										<span>内存限制</span>
										<input
											value={draft.memoryLimit}
											onChange={(event) => updateField("memoryLimit", event.target.value)}
										/>
									</label>
								</div>
							</section>

							<section className="card side-card">
								<div className="side-heading">
									<h2>附件</h2>
									<span>{attachments.length}</span>
								</div>
								{attachments.length === 0 && (
									<p className="muted">上传图片后，可将 `file://文件名` 引用插入题面。</p>
								)}
								<ul className="attachment-list">
									{attachments.map((attachment) => (
										<li key={attachment.name}>
											<span title={attachment.name}>{attachment.name}</span>
											<div>
												<button type="button" onClick={() => insertAttachment(attachment)}>
													插入
												</button>
												<button
													className="danger"
													type="button"
													onClick={() => {
														setAttachments((current) =>
															current.filter((item) => item.name !== attachment.name),
														);
														invalidateValidation();
													}}
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
										onChange={addAttachments}
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
									<li className={validationClass}>
										<span>2</span>
										<div>
											<strong>格式校验</strong>
											<small>{validation?.valid === true ? "检查通过" : "等待检查"}</small>
										</div>
									</li>
									<li className={agentClass}>
										<span>3</span>
										<div>
											<strong>Skill 整理与打包</strong>
											<small>
												{agentRun === undefined
													? agentAvailable
														? "等待运行"
														: "模型未配置"
													: agentStatusLabel(agentRun.status)}
											</small>
										</div>
									</li>
									<li className={algorithmValidation.className}>
										<span>4</span>
										<div>
											<strong>算法与数据验证</strong>
											<small>{algorithmValidation.message}</small>
										</div>
									</li>
									<li>
										<span>5</span>
										<div>
											<strong>Hydro 实测</strong>
											<small>尚未配置测试实例</small>
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
									{agentAvailable
										? "模型已就绪，自动编写标程和 testlib 制题工程，必要时生成 C++ SPJ。无需预先上传程序。"
										: "在设置页配置 AI API 后，即可从题面创建制题任务。"}
								</p>
							</section>
						</aside>
					</div>
				</main>
			)}

			{page === "runs" && (
				<RunsPage
					apiOrigin={apiOrigin}
					runs={runs}
					status={runsStatus}
					message={runsMessage}
					onRefresh={() => void loadRuns()}
					onOpenRun={openHistoryRun}
					onDeleteRun={(run) => void deleteRun(run)}
					deletingRunIds={deletingRunIds}
				/>
			)}

			{page === "settings" && (
				<SettingsPage
					apiOrigin={apiOrigin}
					apiOriginDraft={apiOriginDraft}
					apiStatus={apiStatus}
					agentAvailable={agentAvailable}
					agentModels={agentModels}
					sandbox={sandbox}
					connectionMessage={connectionMessage}
					onApiOriginChange={setApiOriginDraft}
					onSave={saveApiConfiguration}
					onReset={resetApiConfiguration}
					onAiConfigurationChanged={() => void checkApiConnection(apiOrigin)}
				/>
			)}
			<footer>Hydro Problem Make · Hydro 默认比较器 / C++ testlib SPJ</footer>
		</>
	);
}
