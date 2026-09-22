import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			alias: [
				{
					find: /^@earendil-works\/pi-coding-agent$/,
					replacement: workspaceSourcePaths.codingAgentIndex,
				},
				{
					find: /^@hydro-problem-make\/authoring$/,
					replacement: fileURLToPath(new URL("../hydro-authoring/src/index.ts", import.meta.url)),
				},
			],
		},
	}),
);
