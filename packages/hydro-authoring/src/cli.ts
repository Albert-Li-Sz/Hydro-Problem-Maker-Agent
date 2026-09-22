#!/usr/bin/env node

import { resolve } from "node:path";
import { validateHydroDirectory } from "./directory-validator.ts";

function usage(): never {
	console.error("Usage: hydro-authoring validate <problem-directory> [--json]");
	process.exit(2);
}

const [, , command, directory, ...flags] = process.argv;
if (command !== "validate" || directory === undefined || flags.some((flag) => flag !== "--json")) usage();

const report = await validateHydroDirectory(resolve(directory));
if (flags.includes("--json")) {
	console.log(JSON.stringify(report, null, 2));
} else {
	for (const issue of report.issues)
		console.log(`${issue.severity.toUpperCase()} ${issue.code} ${issue.path}: ${issue.message}`);
	const summary = report.stats
		? `${report.stats.statements} statement(s), ${report.stats.testCases} case(s), ${report.stats.attachments} attachment(s)`
		: "no package statistics";
	console.log(`${report.valid ? "VALID" : "INVALID"}: ${summary}`);
}
if (!report.valid) process.exitCode = 1;
