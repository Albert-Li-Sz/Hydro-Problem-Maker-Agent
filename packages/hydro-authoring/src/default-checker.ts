export interface OutputMismatch {
	line: number;
	expected: string | undefined;
	actual: string | undefined;
}

export interface OutputComparison {
	equal: boolean;
	mismatch?: OutputMismatch;
}

function normalizeDefaultOutput(output: string): string[] {
	const lines = output.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
	for (let index = 0; index < lines.length; index += 1) lines[index] = lines[index].replace(/[\t ]+$/, "");
	while (lines.at(-1) === "") lines.pop();
	return lines;
}

export function compareHydroDefaultOutput(expected: string, actual: string): OutputComparison {
	const expectedLines = normalizeDefaultOutput(expected);
	const actualLines = normalizeDefaultOutput(actual);
	const lineCount = Math.max(expectedLines.length, actualLines.length);
	for (let index = 0; index < lineCount; index += 1) {
		if (expectedLines[index] !== actualLines[index]) {
			return {
				equal: false,
				mismatch: {
					line: index + 1,
					expected: expectedLines[index],
					actual: actualLines[index],
				},
			};
		}
	}
	return { equal: true };
}
