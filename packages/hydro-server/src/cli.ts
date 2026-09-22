import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DockerHydroSandbox,
	type HydroAgentExecutor,
	HydroAiConfiguration,
	type HydroAiConfigurationController,
} from "@hydro-problem-make/agent";
import { createHydroLiveVerifierFromEnvironment } from "./live-hydro.ts";
import { HydroRunManager } from "./runs.ts";
import { createHydroServer } from "./server.ts";

const portValue = Number.parseInt(process.env.PORT ?? "4321", 10);
if (!Number.isSafeInteger(portValue) || portValue < 1 || portValue > 65535) throw new Error("PORT must be 1-65535.");
const maxConcurrentRuns = Number(process.env.HYDRO_MAX_CONCURRENT_RUNS ?? "2");
if (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 8) {
	throw new Error("HYDRO_MAX_CONCURRENT_RUNS must be an integer from 1 to 8.");
}

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const workspaceRoot = resolve(projectRoot, process.env.HYDRO_WORKSPACE_ROOT ?? ".hydro-problem-make");
const sandbox = new DockerHydroSandbox(process.env.HYDRO_SANDBOX_IMAGE);
const liveVerifier = createHydroLiveVerifierFromEnvironment();
let aiConfiguration: (HydroAiConfigurationController & HydroAgentExecutor) | undefined;
let runManager: HydroRunManager | undefined;
try {
	aiConfiguration = await HydroAiConfiguration.create({
		workspaceRoot,
		sandbox,
		agentDir: resolve(projectRoot, process.env.HYDRO_AGENT_DIR ?? ".hydro-problem-make/agent"),
		skillPath: resolve(projectRoot, process.env.HYDRO_SKILL_PATH ?? ".pi/skills/hydro-problem-authoring/SKILL.md"),
		configPath: resolve(projectRoot, process.env.HYDRO_AI_CONFIG_PATH ?? ".hydro-problem-make/ai-config.json"),
		enableAmbientCredentials: process.env.HYDRO_ENABLE_AGENT === "1",
		provider: process.env.HYDRO_MODEL_PROVIDER,
		modelId: process.env.HYDRO_MODEL_ID,
	});
	runManager = new HydroRunManager(aiConfiguration, resolve(workspaceRoot, "runs.json"), maxConcurrentRuns);
} catch (error) {
	console.warn(`Pi Agent configuration could not start: ${error instanceof Error ? error.message : "unknown error"}`);
}

const server = createHydroServer({
	staticRoot: process.env.HYDRO_WEB_ROOT === undefined ? undefined : resolve(process.env.HYDRO_WEB_ROOT),
	runManager,
	aiConfiguration,
	sandbox,
	liveVerifier,
});
server.listen(portValue, "127.0.0.1", () => {
	console.log(`Hydro Problem Make API listening on http://127.0.0.1:${portValue}`);
	console.log(`Agent generation: ${runManager?.getReadiness().available === true ? "enabled" : "disabled"}`);
	console.log(`Concurrent workflows: ${runManager?.getMaxConcurrentRuns() ?? 0}`);
	console.log(`Live Hydro verification: ${liveVerifier?.status().message ?? "not configured"}`);
});
