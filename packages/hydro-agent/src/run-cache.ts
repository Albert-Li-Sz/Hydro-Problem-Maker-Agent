import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isSafeFlatName } from "@hydro-problem-make/authoring";

export function cacheKey(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.filter((key) => record[key] !== undefined)
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(",")}}`;
}

function cachePath(workspaceRoot: string, runId: string, namespace: string, key: string): string {
	if (![runId, namespace, key].every(isSafeFlatName)) throw new Error("Invalid cache path.");
	return join(resolve(workspaceRoot), "artifacts", runId, "cache", namespace, `${key}.json`);
}

export async function readRunCache<T>(
	workspaceRoot: string,
	runId: string,
	namespace: string,
	key: string,
): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(cachePath(workspaceRoot, runId, namespace, key), "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function writeRunCache(
	workspaceRoot: string,
	runId: string,
	namespace: string,
	key: string,
	value: unknown,
): Promise<void> {
	const path = cachePath(workspaceRoot, runId, namespace, key);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, JSON.stringify(value));
	await rename(temporary, path);
}
