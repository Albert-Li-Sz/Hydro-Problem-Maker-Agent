import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	AuthoringSummary,
	HydroAgentExecutionOutcome,
	HydroAgentExecutor,
	HydroAgentProgressEvent,
	HydroConversationMessage,
	HydroReferenceProgram,
	HydroSandboxReport,
} from "@hydro-problem-make/agent";
import { isSafeFlatName, type ValidationReport } from "@hydro-problem-make/authoring";

export type HydroRunStatus = "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";

export interface HydroRunArtifact {
	slug: string;
	report: ValidationReport;
	verification?: HydroSandboxReport;
	authoring?: AuthoringSummary;
}

export interface HydroRunSnapshot {
	id: string;
	status: HydroRunStatus;
	source: string;
	createdAt: string;
	updatedAt: string;
	model?: string;
	assistantText: string;
	error?: string;
	artifact?: HydroRunArtifact;
	conversation?: HydroConversationMessage[];
	referenceProgram?: HydroReferenceProgram;
	lastEventSequence?: number;
}

export interface HydroRunEvent {
	sequence: number;
	runId: string;
	type: "status" | "text_delta" | "tool";
	createdAt: string;
	message: string;
	status?: HydroRunStatus;
}

interface MutableRun extends HydroRunSnapshot {
	artifactDirectory?: string;
	events: HydroRunEvent[];
	listeners: Set<(event: HydroRunEvent) => void>;
	abortController?: AbortController;
	deleting?: boolean;
}

function isTerminal(status: HydroRunStatus): boolean {
	return status === "needs_input" || status === "succeeded" || status === "failed" || status === "cancelled";
}

function snapshot(run: MutableRun): HydroRunSnapshot {
	return {
		id: run.id,
		status: run.status,
		source: run.source,
		createdAt: run.createdAt,
		updatedAt: run.updatedAt,
		model: run.model,
		assistantText: run.assistantText,
		error: run.error,
		artifact: run.artifact,
		conversation: run.conversation ?? [],
		referenceProgram: run.referenceProgram,
		lastEventSequence: run.events.at(-1)?.sequence ?? 0,
	};
}

export class HydroRunManager {
	private readonly executor: HydroAgentExecutor;
	private readonly runs = new Map<string, MutableRun>();
	private readonly queue: string[] = [];
	private activeRuns = 0;
	private readonly maxConcurrentRuns: number;
	private readonly storagePath?: string;

	constructor(executor: HydroAgentExecutor, storagePath?: string, maxConcurrentRuns = 2) {
		if (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 8) {
			throw new Error("maxConcurrentRuns must be an integer from 1 to 8.");
		}
		this.executor = executor;
		this.storagePath = storagePath;
		this.maxConcurrentRuns = maxConcurrentRuns;
		if (storagePath) this.restore(storagePath);
	}

	create(source: string, referenceProgram?: HydroReferenceProgram): HydroRunSnapshot {
		const normalizedSource = source.trim();
		if (normalizedSource.length === 0) throw new Error("Problem source cannot be empty.");
		if (normalizedSource.length > 200_000) throw new Error("Problem source exceeds 200000 characters.");
		const timestamp = new Date().toISOString();
		const run: MutableRun = {
			id: randomUUID(),
			status: "queued",
			source: normalizedSource,
			createdAt: timestamp,
			updatedAt: timestamp,
			assistantText: "",
			conversation: [],
			referenceProgram,
			events: [],
			listeners: new Set(),
		};
		this.runs.set(run.id, run);
		this.queue.push(run.id);
		this.emit(run, { type: "status", message: "任务已进入队列。", status: "queued" });
		this.persist();
		void this.drain();
		return snapshot(run);
	}

	continue(
		runId: string,
		input: { message: string; referenceProgram?: HydroReferenceProgram | null },
	): HydroRunSnapshot {
		const run = this.runs.get(runId);
		if (run === undefined) throw new Error("任务不存在。");
		if (!["needs_input", "failed", "cancelled"].includes(run.status) || run.abortController || run.deleting) {
			throw new Error("当前任务尚未结束或已经完成，不能继续。");
		}
		const message = input.message.trim();
		if (!message || message.length > 200_000) throw new Error("补充信息须为 1–200000 个字符。");
		run.conversation ??= [];
		if (run.assistantText) run.conversation.push({ role: "assistant", content: run.assistantText });
		run.conversation.push({ role: "user", content: message });
		if (input.referenceProgram !== undefined) run.referenceProgram = input.referenceProgram ?? undefined;
		run.assistantText = "";
		run.error = undefined;
		run.status = "queued";
		run.updatedAt = new Date().toISOString();
		this.queue.push(run.id);
		this.emit(run, { type: "status", status: "queued", message: "已收到补充信息，继续任务。" });
		this.persist();
		void this.drain();
		return snapshot(run);
	}

	get(runId: string): HydroRunSnapshot | undefined {
		const run = this.runs.get(runId);
		return run === undefined ? undefined : snapshot(run);
	}

	list(): HydroRunSnapshot[] {
		return [...this.runs.values()].reverse().map(snapshot);
	}

	getReadiness(): HydroAgentExecutor["readiness"] {
		return this.executor.readiness;
	}

	getMaxConcurrentRuns(): number {
		return this.maxConcurrentRuns;
	}

	getEvents(runId: string, afterSequence = 0): HydroRunEvent[] | undefined {
		const run = this.runs.get(runId);
		return run?.events.filter((event) => event.sequence > afterSequence);
	}

	getArtifactDirectory(runId: string): string | undefined {
		return this.runs.get(runId)?.artifactDirectory;
	}

	async delete(runId: string): Promise<boolean> {
		const run = this.runs.get(runId);
		if (!run) return false;
		if (!isTerminal(run.status) || run.abortController || run.deleting)
			throw new Error("任务仍在运行、退出或删除中，请稍后重试。");
		run.deleting = true;
		try {
			if (this.storagePath) {
				if (!isSafeFlatName(runId)) throw new Error("无效的任务 ID。");
				const root = dirname(this.storagePath);
				await rm(join(root, "artifacts", runId), { recursive: true, force: true });
				await rm(join(root, "sessions", runId), { recursive: true, force: true });
			}
			this.runs.delete(runId);
			this.persist();
			return true;
		} finally {
			run.deleting = false;
		}
	}

	subscribe(runId: string, listener: (event: HydroRunEvent) => void): (() => void) | undefined {
		const run = this.runs.get(runId);
		if (run === undefined) return undefined;
		run.listeners.add(listener);
		return () => run.listeners.delete(listener);
	}

	cancel(runId: string): boolean {
		const run = this.runs.get(runId);
		if (run === undefined || isTerminal(run.status)) return false;
		run.abortController?.abort();
		this.transition(run, "cancelled", "任务已取消。");
		return true;
	}

	private emit(run: MutableRun, event: Omit<HydroRunEvent, "sequence" | "runId" | "createdAt">): void {
		const item: HydroRunEvent = {
			...event,
			sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
			runId: run.id,
			createdAt: new Date().toISOString(),
		};
		run.events.push(item);
		for (const listener of run.listeners) {
			try {
				listener(item);
			} catch {
				// A disconnected event consumer must not affect the authoring run.
			}
		}
	}

	private transition(run: MutableRun, status: HydroRunStatus, message: string): void {
		if (isTerminal(run.status)) return;
		run.status = status;
		run.updatedAt = new Date().toISOString();
		this.emit(run, { type: "status", message, status });
		this.persist();
	}

	private handleProgress(run: MutableRun, event: HydroAgentProgressEvent): void {
		if (run.status !== "running") return;
		if (event.type === "text_delta") {
			run.assistantText += event.delta;
			run.updatedAt = new Date().toISOString();
			this.emit(run, { type: "text_delta", message: event.delta });
			return;
		}
		const message =
			event.type === "tool_started"
				? `开始执行 ${event.toolName}`
				: `${event.toolName} ${event.isError ? "执行失败" : "执行完成"}`;
		this.emit(run, { type: "tool", message });
	}

	private applyOutcome(run: MutableRun, outcome: HydroAgentExecutionOutcome): void {
		run.model = outcome.model;
		run.assistantText = outcome.assistantText;
		if (outcome.artifact !== undefined) {
			run.artifact = {
				slug: outcome.artifact.slug,
				report: outcome.artifact.report,
				verification: outcome.artifact.verification,
				authoring: outcome.artifact.authoring,
			};
			run.artifactDirectory = outcome.artifact.directory;
		}
		if (outcome.status === "succeeded") this.transition(run, "succeeded", "Hydro 题目目录已生成并通过格式检查。");
		else if (outcome.status === "needs_input") this.transition(run, "needs_input", "需要补充题目信息。");
		else this.transition(run, "failed", "Agent 未能生成有效的 Hydro 题目目录。");
	}

	private isCancelled(runId: string): boolean {
		return this.runs.get(runId)?.status === "cancelled";
	}

	private drain(): void {
		while (this.activeRuns < this.maxConcurrentRuns && this.queue.length > 0) {
			const runId = this.queue.shift();
			if (runId === undefined) continue;
			const run = this.runs.get(runId);
			if (run === undefined || run.status !== "queued") continue;
			this.activeRuns += 1;
			void this.executeRun(run);
		}
	}

	private async executeRun(run: MutableRun): Promise<void> {
		const abortController = new AbortController();
		run.abortController = abortController;
		this.transition(run, "running", "Agent 已开始整理题目。");
		try {
			const outcome = await this.executor.execute({
				runId: run.id,
				source: run.source,
				conversation: run.conversation,
				referenceProgram: run.referenceProgram,
				signal: abortController.signal,
				onEvent: (event) => this.handleProgress(run, event),
			});
			if (!this.isCancelled(run.id)) this.applyOutcome(run, outcome);
		} catch (error) {
			if (!this.isCancelled(run.id)) {
				run.error = error instanceof Error ? error.message : "Unknown Agent error.";
				this.transition(run, "failed", "Agent 执行失败。");
			}
		} finally {
			run.abortController = undefined;
			this.activeRuns -= 1;
			this.drain();
		}
	}

	private persist(): void {
		if (!this.storagePath) return;
		mkdirSync(dirname(this.storagePath), { recursive: true });
		const runs = [...this.runs.values()].map((run) => ({ ...snapshot(run), events: run.events }));
		const temporary = `${this.storagePath}.tmp`;
		writeFileSync(temporary, JSON.stringify({ runs }), { mode: 0o600 });
		renameSync(temporary, this.storagePath);
	}

	private restore(storagePath: string): void {
		let data: { runs: Array<HydroRunSnapshot & { events?: HydroRunEvent[] }> };
		try {
			data = JSON.parse(readFileSync(storagePath, "utf8")) as typeof data;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		for (const stored of data.runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
			const interrupted = stored.status === "running" || stored.status === "queued";
			this.runs.set(stored.id, {
				...stored,
				status: interrupted ? "needs_input" : stored.status,
				error: interrupted ? "服务已重启，请点击继续任务。" : stored.error,
				conversation: stored.conversation ?? [],
				artifactDirectory: stored.artifact
					? join(dirname(storagePath), "artifacts", stored.id, "hydro", stored.artifact.slug)
					: undefined,
				events: stored.events ?? [],
				listeners: new Set(),
			});
		}
	}
}
