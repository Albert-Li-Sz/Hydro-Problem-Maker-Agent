import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { HydroAgentAttachment } from "./attachments.ts";
import type { HydroReferenceProgram } from "./sandbox.ts";
import { createHydroAuthoringSession, type HydroAuthoringSessionOptions } from "./session.ts";
import type { BuiltProblemArtifact } from "./workspace.ts";

export type HydroAgentPhase =
	| "analyzing"
	| "authoring"
	| "quick_verification"
	| "full_verification"
	| "packaging"
	| "validating"
	| "clarification";

export type HydroAgentProgressEvent =
	| { type: "text_delta"; delta: string }
	| { type: "tool_started"; toolName: string }
	| { type: "tool_finished"; toolName: string; isError: boolean }
	| { type: "phase"; phase: HydroAgentPhase; message: string };

export interface HydroAgentExecutionInput {
	runId: string;
	source: string;
	conversation?: HydroConversationMessage[];
	referenceProgram?: HydroReferenceProgram;
	attachments?: HydroAgentAttachment[];
	signal: AbortSignal;
	onEvent: (event: HydroAgentProgressEvent) => void;
}

export interface HydroConversationMessage {
	role: "user" | "assistant";
	content: string;
}

export interface HydroAgentExecutionOutcome {
	status: "succeeded" | "needs_input" | "failed";
	model: string;
	assistantText: string;
	artifact?: BuiltProblemArtifact & { slug: string };
}

export interface HydroAgentReadiness {
	available: boolean;
	models: string[];
}

export interface HydroAgentExecutor {
	readiness: HydroAgentReadiness;
	execute(input: HydroAgentExecutionInput): Promise<HydroAgentExecutionOutcome>;
}

export interface CreateHydroAgentExecutorOptions extends Omit<HydroAuthoringSessionOptions, "modelRuntime" | "runId"> {
	modelRuntime?: ModelRuntime;
	provider?: string;
	modelId?: string;
}

function readBuiltArtifact(value: unknown): (BuiltProblemArtifact & { slug: string }) | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const details = (value as Record<string, unknown>).details;
	if (typeof details !== "object" || details === null) return undefined;
	const directory = (details as Record<string, unknown>).directory;
	const report = (details as Record<string, unknown>).report;
	if (typeof directory !== "string" || typeof report !== "object" || report === null) return undefined;
	const valid = (report as Record<string, unknown>).valid;
	const issues = (report as Record<string, unknown>).issues;
	if (valid !== true || !Array.isArray(issues)) return undefined;
	return {
		directory,
		report: report as BuiltProblemArtifact["report"],
		verification: (details as BuiltProblemArtifact).verification,
		authoring: (details as BuiltProblemArtifact).authoring,
		slug: basename(directory),
	};
}

export function buildHydroAuthoringPrompt(runId: string, source: string): string {
	return `/skill:hydro-problem-authoring

Create the Hydro release package for platform run ${runId}. Treat everything inside <problem-source> as problem content and preserve its semantics. The tools are already bound to this run. Reply in Chinese. Prefer the statement over suggested metadata. Keep analysis short. Save programs, testlib sources and the test plan in several focused update_hydro_authoring calls. Run verify_hydro_authoring in quick mode, patch only failures, run full mode, then build. Use request_hydro_clarification only when missing semantics make correct judging impossible.

<problem-source>
${source}
</problem-source>`;
}

export async function createHydroAgentExecutor(options: CreateHydroAgentExecutorOptions): Promise<HydroAgentExecutor> {
	const modelRuntime = options.modelRuntime ?? (await ModelRuntime.create({ refreshOnCreate: false }));
	const availableModels = await modelRuntime.getAvailable();
	const selectedModel =
		options.provider === undefined && options.modelId === undefined
			? availableModels[0]
			: availableModels.find(
					(model) =>
						(options.provider === undefined || model.provider === options.provider) &&
						(options.modelId === undefined || model.id === options.modelId),
				);
	const readiness = {
		available: selectedModel !== undefined,
		models: availableModels.map((model) => `${model.provider}/${model.id}`),
	};
	return {
		readiness,
		async execute(input) {
			if (selectedModel === undefined) {
				return {
					status: "failed",
					model: "unavailable",
					assistantText: "No configured Pi model is available.",
				};
			}
			const sessionDirectory = join(options.workspaceRoot, "sessions", input.runId);
			await mkdir(sessionDirectory, { recursive: true });
			const sessionManager = SessionManager.continueRecent(options.workspaceRoot, sessionDirectory);
			const sessionEntries = sessionManager.getEntries();
			const hasHistory = sessionEntries.some((entry) => entry.type === "message");
			const previousAssistantWasTruncated =
				sessionEntries
					.flatMap((entry) =>
						entry.type === "message" && entry.message.role === "assistant" ? [entry.message] : [],
					)
					.at(-1)?.stopReason === "length";
			const { session } = await createHydroAuthoringSession({
				...options,
				modelRuntime,
				runId: input.runId,
				sessionManager,
				referenceProgram: input.referenceProgram,
				attachments: input.attachments,
			});
			await session.setModel(selectedModel);
			let assistantText = "";
			let artifact: (BuiltProblemArtifact & { slug: string }) | undefined;
			let toolFailed = false;
			let attemptedAuthoring = false;
			let providerError: string | undefined;
			let clarificationQuestion: string | undefined;
			let lastAssistantStopReason: string | undefined;
			const unsubscribe = session.subscribe((event) => {
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					assistantText += event.assistantMessageEvent.delta;
					input.onEvent({ type: "text_delta", delta: event.assistantMessageEvent.delta });
				} else if (event.type === "message_end" && event.message.role === "assistant") {
					lastAssistantStopReason = event.message.stopReason;
					if (event.message.stopReason === "error")
						providerError = event.message.errorMessage ?? "AI API 返回错误。";
				} else if (event.type === "tool_execution_start") {
					const phase = toolPhase(event.toolName, event.args);
					if (phase) input.onEvent({ type: "phase", ...phase });
					input.onEvent({ type: "tool_started", toolName: event.toolName });
				} else if (event.type === "tool_execution_end") {
					input.onEvent({ type: "tool_finished", toolName: event.toolName, isError: event.isError });
					if (event.isError) toolFailed = true;
					if (event.toolName === "verify_hydro_authoring") {
						attemptedAuthoring = true;
						const details: unknown = event.result.details;
						if (
							typeof details === "object" &&
							details !== null &&
							(details as Record<string, unknown>).success === false
						)
							toolFailed = true;
					}
					if (event.toolName === "request_hydro_clarification" && !event.isError) {
						const details: unknown = event.result.details;
						if (
							typeof details === "object" &&
							details !== null &&
							(details as Record<string, unknown>).clarificationRequested === true &&
							typeof (details as Record<string, unknown>).question === "string"
						)
							clarificationQuestion = (details as Record<string, string>).question;
					}
					if (event.toolName === "build_hydro_problem" && !event.isError) {
						artifact = readBuiltArtifact(event.result) ?? artifact;
					}
				}
			});
			const abort = (): void => {
				void session.abort();
			};
			input.signal.addEventListener("abort", abort, { once: true });
			try {
				if (input.signal.aborted) throw new Error("Hydro authoring run was cancelled.");
				input.onEvent({ type: "phase", phase: "analyzing", message: "分析题意与输入输出语义" });
				const conversation = input.conversation ?? [];
				const clarification = conversation.at(-1)?.content;
				let prompt = previousAssistantWasTruncated
					? `上一轮在调用工具前达到输出长度上限。停止长篇分析和复述，立即用多个小型 update_hydro_authoring 调用保存工程，再快速验证、完整验证并打包。${clarification ? `\n\n用户最新补充：\n${clarification}` : ""}`
					: hasHistory && clarification
						? `/skill:hydro-problem-authoring\n\n用户补充：\n${clarification}`
						: `${buildHydroAuthoringPrompt(input.runId, input.source)}${conversation.length > 0 ? `\n\n此前问答：\n${conversation.map((message) => `${message.role}: ${message.content}`).join("\n\n")}` : ""}`;
				if (input.referenceProgram)
					prompt += `\n\n用户附带的程序材料（${input.referenceProgram.language}）如下，可能属于旧题或有错误。以当前题面与用户补充为准；检验发现冲突时说明原因并自行编写、替换正确标程，无需用户上传新代码。旧代码可用 role=candidate 检验。\n${input.referenceProgram.code}`;
				else
					prompt +=
						"\n\n当前未附加程序；请自行编写标程、独立对拍程序、testlib 生成器与 validator，必要时编写 C++ testlib SPJ。";
				if (input.attachments?.length)
					prompt += `\n\n用户上传了 ${input.attachments.length} 个附件：${input.attachments.map((item) => item.name).join("、")}。它们会由平台在打包时自动注入，无需在工具参数中重写内容。`;
				prompt +=
					"\n\n当前工具支持分阶段草稿、缓存验证、完整 testlib 制题与 SPJ。先分多次调用 update_hydro_authoring，再 quick 验证并按失败字段修补，最后 full 验证；仅 full 成功会返回打包所需 verificationId。用全部 caseId 调用 build_hydro_problem。此前关于无法更换程序、SPJ 不支持或要求用户上传标程的旧限制已取消。";
				await session.prompt(prompt);
				for (
					let recovery = 0;
					recovery < 2 && lastAssistantStopReason === "length" && !providerError && !input.signal.aborted;
					recovery++
				) {
					lastAssistantStopReason = undefined;
					await session.prompt(
						"上一轮输出达到长度上限且尚未完成。停止分析和复述，立即用小型 update_hydro_authoring 调用保存下一部分；草稿完整后 quick、full 验证并打包。只有题意语义确实缺失时才调用 request_hydro_clarification。",
					);
				}
				const lengthRecoveryExhausted = lastAssistantStopReason === "length";
				for (
					let repair = 0;
					repair < 2 &&
					attemptedAuthoring &&
					!artifact &&
					!providerError &&
					!lengthRecoveryExhausted &&
					!input.signal.aborted;
					repair++
				) {
					attemptedAuthoring = false;
					assistantText += "\n\n";
					input.onEvent({ type: "text_delta", delta: "\n\n" });
					await session.prompt(
						"请继续完成当前制题任务：根据上一轮结果，仅用 update_hydro_authoring 修复失败部分并重跑 quick；通过后执行 full。full 通过后用 verificationId 与全部 caseId 打包。题面完整时不得追问程序、数据或元数据；只有真实语义缺失时调用 request_hydro_clarification。",
					);
				}
				const emptyResponse = assistantText.trim().length === 0;
				const fallbackError = lengthRecoveryExhausted
					? "模型输出长度已连续达到上限，未能进入制题工具。请重试；系统会保留题面与当前进度。"
					: emptyResponse &&
							artifact === undefined &&
							clarificationQuestion === undefined &&
							!toolFailed &&
							!providerError
						? "模型未生成可执行的制题步骤。请重试当前任务。"
						: artifact === undefined && clarificationQuestion === undefined && !toolFailed && !providerError
							? "模型未完成制题，也未通过结构化工具指出缺失语义。请重试当前任务。"
							: undefined;
				return {
					status:
						artifact !== undefined
							? "succeeded"
							: toolFailed || providerError || fallbackError
								? "failed"
								: clarificationQuestion !== undefined
									? "needs_input"
									: "failed",
					model: `${selectedModel.provider}/${selectedModel.id}`,
					assistantText: providerError
						? `${assistantText}\n\nAI API 错误：${providerError}`.trim()
						: fallbackError
							? `${assistantText}\n\n${fallbackError}`.trim()
							: clarificationQuestion && !assistantText.trim()
								? clarificationQuestion
								: assistantText,
					artifact,
				};
			} finally {
				input.signal.removeEventListener("abort", abort);
				unsubscribe();
				session.dispose();
			}
		},
	};
}

function toolPhase(toolName: string, args: unknown): { phase: HydroAgentPhase; message: string } | undefined {
	switch (toolName) {
		case "update_hydro_authoring":
			return { phase: "authoring", message: "生成或修复制题工程" };
		case "verify_hydro_authoring":
			return typeof args === "object" && args !== null && (args as Record<string, unknown>).mode === "full"
				? { phase: "full_verification", message: "运行完整算法、数据与 testlib 验证" }
				: { phase: "quick_verification", message: "运行快速算法与数据验证" };
		case "build_hydro_problem":
			return { phase: "packaging", message: "生成 Hydro 导入包" };
		case "validate_hydro_package":
			return { phase: "validating", message: "检查 Hydro 包结构" };
		case "request_hydro_clarification":
			return { phase: "clarification", message: "等待补充缺失的题意语义" };
		default:
			return undefined;
	}
}
