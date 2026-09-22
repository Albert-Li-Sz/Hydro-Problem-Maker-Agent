import { describe, expect, it } from "vitest";
import { DockerHydroSandbox } from "../src/sandbox.ts";

// Explicit opt-in: these integration tests require the local Docker image, never an AI provider.
describe.runIf(process.env.HYDRO_TEST_SANDBOX === "1")("Linux standard-program sandbox", () => {
	const sandbox = new DockerHydroSandbox();
	it("computes the full no-input 三连击 output with C++17", async () => {
		expect((await sandbox.status()).available).toBe(true);
		const result = await sandbox.run({
			program: {
				language: "cpp17",
				code: `#include <iostream>
#include <string>
#include <algorithm>
int main() { for (int a=123; a<=329; ++a) { std::string s=std::to_string(a)+std::to_string(a*2)+std::to_string(a*3); std::sort(s.begin(),s.end()); if(s=="123456789") std::cout<<a<<" "<<a*2<<" "<<a*3<<"\\n"; } }`,
			},
			cases: [{ input: "" }],
		});
		expect(result.success, JSON.stringify(result)).toBe(true);
		expect(result.cases[0]).toMatchObject({
			status: "generated",
			stdout: "192 384 576\n219 438 657\n273 546 819\n327 654 981\n",
		});
	}, 45_000);

	it("compares Python output and reports wrong answers separately", async () => {
		const result = await sandbox.run({
			program: { language: "python3", code: "print(sum(map(int, input().split())))" },
			cases: [
				{ input: "-5 8", expectedOutput: "3\n" },
				{ input: "1 2", expectedOutput: "4\n" },
			],
		});
		expect(result.compiled, result.compileOutput).toBe(true);
		expect(result.cases.map((item) => item.status)).toEqual(["passed", "wrong_answer"]);
		expect(result.success).toBe(false);
	}, 45_000);

	it("compiles and runs a Java Main program", async () => {
		const result = await sandbox.run({
			program: {
				language: "java",
				code: 'public class Main { public static void main(String[] args) { System.out.println("42"); } }',
			},
			cases: [{ input: "", expectedOutput: "42\n" }],
		});
		expect(result.success, JSON.stringify(result)).toBe(true);
	}, 45_000);

	it("reports compiler errors and enforces case time and output limits", async () => {
		const failed = await sandbox.run({ program: { language: "cpp17", code: "int main( {" }, cases: [{ input: "" }] });
		expect(failed.compiled).toBe(false);
		expect(failed.compileOutput).toContain("error:");
		const timed = await sandbox.run({
			program: { language: "python3", code: "while True: pass" },
			cases: [{ input: "" }],
			timeLimitMs: 100,
		});
		expect(timed.cases[0].status).toBe("time_limit");
		const output = await sandbox.run({
			program: { language: "python3", code: 'print("x" * (2 * 1024 * 1024))' },
			cases: [{ input: "" }],
		});
		expect(output.cases[0].status).toBe("output_limit");
	}, 45_000);

	it("isolates programs from credentials and external networks, and supports cancellation", async () => {
		const isolated = await sandbox.run({
			program: {
				language: "python3",
				code: 'import os, socket\nassert not any("API_KEY" in k for k in os.environ)\ns=socket.socket(); s.settimeout(0.1)\ntry:\n s.connect(("1.1.1.1", 443))\n print("connected")\nexcept OSError:\n print("isolated")',
			},
			cases: [{ input: "", expectedOutput: "isolated\n" }],
		});
		expect(isolated.success, JSON.stringify(isolated)).toBe(true);
		const controller = new AbortController();
		const pending = sandbox.run(
			{ program: { language: "python3", code: "while True: pass" }, cases: [{ input: "" }], timeLimitMs: 10000 },
			controller.signal,
		);
		setTimeout(() => controller.abort(), 800);
		await expect(pending).rejects.toThrow("取消");
	}, 45_000);
});
