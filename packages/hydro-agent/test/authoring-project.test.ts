import { describe, expect, it } from "vitest";
import { DockerHydroSandbox } from "../src/sandbox.ts";
import { appleProject, divisorProject } from "./authoring-fixtures.ts";

describe.runIf(process.env.HYDRO_TEST_SANDBOX === "1")("testlib authoring pipeline", () => {
	const sandbox = new DockerHydroSandbox();
	it("limits quick verification to a representative subset", async () => {
		const report = await sandbox.verifyProject(appleProject, { mode: "quick" });
		expect(report.mode).toBe("quick");
		expect(report.success, JSON.stringify(report.checks.filter((item) => !item.passed))).toBe(true);
		expect(report.cases.length).toBeLessThanOrEqual(8);
		expect(report.checks.some((item) => item.stage === "wrong-program-survived")).toBe(false);
	}, 90_000);
	it("generates apples data, validates it, checks an independent oracle and kills the stale 三连击 program", async () => {
		const report = await sandbox.verifyProject(appleProject);
		expect(report.success, JSON.stringify(report.checks.filter((item) => !item.passed))).toBe(true);
		expect(report.cases[0].output).toBe("5\n");
		expect(report.checks.filter((item) => item.stage === "oracle" && item.passed)).toHaveLength(14);
		expect(report.checks.filter((item) => item.stage === "wrong-program-killed" && item.passed)).toHaveLength(2);
		expect(report.checks.filter((item) => item.stage === "reproducibility" && item.passed)).toHaveLength(12);
	}, 90_000);
	it("accepts alternative correct answers through C++ testlib SPJ, rejects malformed answers and detects wrong checkers", async () => {
		const report = await sandbox.verifyProject(divisorProject);
		expect(report.success, JSON.stringify(report.checks.filter((item) => !item.passed))).toBe(true);
		expect(report.checks.filter((item) => item.stage === "checker-probe" && item.passed)).toHaveLength(4);
		const broken = await sandbox.verifyProject({
			...divisorProject,
			checker:
				'#include "testlib.h"\nint main(int argc,char** argv){registerTestlibCmd(argc,argv);quitf(_fail,"checker crashed");}',
		});
		expect(broken.success).toBe(false);
		expect(broken.checks.some((item) => item.stage === "checker-self" && !item.passed)).toBe(true);
		expect(broken.checks.some((item) => item.stage === "wrong-program-killed")).toBe(false);
	}, 120_000);
	it("blocks release when the reference or validator is wrong", async () => {
		const report = await sandbox.verifyProject({
			...appleProject,
			reference: { language: "python3", code: "print(99)" },
			cases: appleProject.cases.slice(0, 3),
		});
		expect(report.success).toBe(false);
		expect(report.checks.some((item) => item.stage === "sample" && !item.passed)).toBe(true);
		expect(report.checks.some((item) => item.stage === "oracle" && !item.passed)).toBe(true);
		const invalidData = await sandbox.verifyProject({
			...divisorProject,
			cases: [...divisorProject.cases, { id: "invalid", purpose: "boundary", input: "21\n" }],
		});
		expect(invalidData.success).toBe(false);
		expect(invalidData.checks).toContainEqual(
			expect.objectContaining({ stage: "validator", caseId: "invalid", passed: false }),
		);
	}, 120_000);
	it("rejects an invalid sample even when the SPJ derives correctness without reading ans", async () => {
		const report = await sandbox.verifyProject({
			...divisorProject,
			cases: divisorProject.cases.map((item) => (item.id === "sample" ? { ...item, expectedOutput: "5\n" } : item)),
		});
		expect(report.success).toBe(false);
		expect(report.checks).toContainEqual(
			expect.objectContaining({ stage: "sample", caseId: "sample", passed: false }),
		);
	}, 60_000);
});
