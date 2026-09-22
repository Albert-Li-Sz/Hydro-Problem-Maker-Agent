import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ModelRuntime,
	SessionManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { HydroReferenceProgram, HydroSandbox } from "./sandbox.ts";
import { createHydroAuthoringTools } from "./tools.ts";

export interface HydroAuthoringResourceOptions {
	workspaceRoot: string;
	agentDir: string;
	skillPath: string;
}

export interface HydroAuthoringSessionOptions extends HydroAuthoringResourceOptions {
	runId: string;
	modelRuntime?: ModelRuntime;
	sessionManager?: SessionManager;
	sandbox?: HydroSandbox;
	referenceProgram?: HydroReferenceProgram;
}

export async function loadHydroAuthoringResources(
	options: HydroAuthoringResourceOptions,
): Promise<DefaultResourceLoader> {
	const contract = await readFile(join(dirname(resolve(options.skillPath)), "references/hydro-contract.md"), "utf8");
	const loader = new DefaultResourceLoader({
		cwd: resolve(options.workspaceRoot),
		agentDir: resolve(options.agentDir),
		additionalSkillPaths: [resolve(options.skillPath)],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		skillsOverride: (resources) => ({
			skills: resources.skills.filter((skill) => skill.name === "hydro-problem-authoring"),
			diagnostics: resources.diagnostics,
		}),
		systemPrompt: `You author Hydro programming problems. Follow the hydro-problem-authoring Skill and use only the enabled tools. Reply in Chinese. When the statement determines valid input and output, do not spend the response on analysis: immediately call verify_hydro_authoring with a complete project, fix its reported failures, then call build_hydro_problem. Ask only about unresolved semantics that make judging impossible. The Skill reference is preloaded below:\n\n${contract}`,
	});
	await loader.reload();
	const resources = loader.getSkills();
	const selected: Skill[] = resources.skills.filter((skill) => skill.name === "hydro-problem-authoring");
	if (resources.diagnostics.length > 0 || selected.length !== 1) {
		throw new Error(`Could not load the Hydro authoring Skill: ${JSON.stringify(resources.diagnostics)}`);
	}
	return loader;
}

export async function createHydroAuthoringSession(options: HydroAuthoringSessionOptions) {
	const workspaceRoot = resolve(options.workspaceRoot);
	const resourceLoader = await loadHydroAuthoringResources(options);
	const customTools = createHydroAuthoringTools(workspaceRoot, options.runId, options);
	return createAgentSession({
		cwd: workspaceRoot,
		agentDir: resolve(options.agentDir),
		modelRuntime: options.modelRuntime,
		resourceLoader,
		sessionManager: options.sessionManager ?? SessionManager.inMemory(workspaceRoot),
		tools: customTools.map((tool) => tool.name),
		customTools,
	});
}
