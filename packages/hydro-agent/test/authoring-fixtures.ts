import type { HydroAuthoringProject } from "../src/authoring-project.ts";

export const noInputProject = {
	reference: { language: "python3", code: "print(42)" },
	oracle: { language: "python3", code: "print(6 * 7)" },
	generator: '#include "testlib.h"\nint main(int argc,char** argv){registerGen(argc,argv,1);}',
	validator: '#include "testlib.h"\nint main(int argc,char** argv){registerValidation(argc,argv);inf.readEof();}',
	cases: [{ id: "empty", purpose: "boundary", generatorArgs: ["seed-1"], expectedOutput: "42\n", oracle: true }],
	invalidInputs: ["unexpected\n"],
	wrongPrograms: [{ name: "wrong constant", program: { language: "python3", code: "print(41)" } }],
	timeLimitMs: 1000,
	memoryLimitMb: 256,
	analysis: "No input; compute six times seven independently and reject any input bytes.",
} satisfies HydroAuthoringProject;

export const appleProject = {
	reference: {
		language: "cpp17",
		code: '#include <iostream>\nint main(){int a[10],x,c=0;for(int &h:a)std::cin>>h;std::cin>>x;for(int h:a)c+=h<=x+30;std::cout<<c<<"\\n";}',
	},
	oracle: {
		language: "python3",
		code: "import sys,bisect\na=list(map(int,sys.stdin.read().split()));print(bisect.bisect_right(sorted(a[:10]),a[10]+30))",
	},
	generator:
		'#include "testlib.h"\n#include <iostream>\nint main(int argc,char** argv){registerGen(argc,argv,1);for(int i=0;i<10;i++)std::cout<<rnd.next(100,200)<<(i==9?"\\n":" ");std::cout<<rnd.next(100,120)<<"\\n";}',
	validator:
		'#include "testlib.h"\nint main(int argc,char** argv){registerValidation(argc,argv);for(int i=0;i<10;i++){inf.readInt(100,200,"height");if(i<9)inf.readSpace();}inf.readEoln();inf.readInt(100,120,"reach");inf.readEoln();inf.readEof();}',
	cases: [
		{
			id: "sample",
			purpose: "sample",
			input: "100 200 150 140 129 134 167 198 200 111\n110\n",
			expectedOutput: "5\n",
			oracle: true,
		},
		{
			id: "equal",
			purpose: "boundary",
			input: "130 131 130 131 130 131 130 131 130 131\n100\n",
			expectedOutput: "5\n",
			oracle: true,
		},
		...Array.from({ length: 12 }, (_, index) => ({
			id: `random-${index}`,
			purpose: "random" as const,
			generatorArgs: [String(100 + index)],
			oracle: true,
		})),
	],
	invalidInputs: [
		"0 200 150 140 129 134 167 198 200 111\n110\n",
		"100 200\n110\n",
		"100 200 150 140 129 134 167 198 200 111\n121\n",
	],
	wrongPrograms: [
		{
			name: "Previous 三连击 program",
			program: { language: "python3", code: 'print("192 384 576\\n219 438 657\\n273 546 819\\n327 654 981")' },
		},
		{
			name: "Strict instead of inclusive boundary",
			program: {
				language: "python3",
				code: "import sys\na=list(map(int,sys.stdin.read().split()));print(sum(h<a[10]+30 for h in a[:10]))",
			},
		},
	],
	timeLimitMs: 1000,
	memoryLimitMb: 256,
	analysis:
		"Count height <= reach+30; independent oracle sorts heights and uses upper_bound. Cover the official sample, equal boundary and twelve deterministic random cases. Old uploaded program and strict comparison must fail.",
} satisfies HydroAuthoringProject;

export const divisorProject = {
	reference: { language: "python3", code: "input(); print(1)" },
	oracle: { language: "python3", code: "print(int(input()))" },
	generator:
		'#include "testlib.h"\n#include <iostream>\nint main(int argc,char** argv){registerGen(argc,argv,1);std::cout<<rnd.next(2,20)<<"\\n";}',
	validator:
		'#include "testlib.h"\nint main(int argc,char** argv){registerValidation(argc,argv);inf.readInt(2,20,"n");inf.readEoln();inf.readEof();}',
	checker:
		'#include "testlib.h"\nint main(int argc,char** argv){registerTestlibCmd(argc,argv);int n=inf.readInt();int d=ouf.readInt(1,n);if(n%d||!ouf.seekEof())quitf(_wa,"not exactly one divisor");quitf(_ok,"valid divisor");}',
	cases: [
		{ id: "sample", purpose: "sample", input: "12\n", expectedOutput: "3\n", oracle: true },
		{ id: "random", purpose: "random", generatorArgs: ["seed-42"], oracle: true },
	],
	invalidInputs: ["0\n", "21\n", "2 3\n"],
	checkerProbes: [
		{ caseId: "sample", output: "4\n", accept: true, description: "Different valid divisor" },
		{ caseId: "sample", output: "5\n", accept: false, description: "Not a divisor" },
		{ caseId: "sample", output: "", accept: false, description: "Empty output" },
		{ caseId: "sample", output: "1 2\n", accept: false, description: "Extra token" },
	],
	wrongPrograms: [{ name: "Nonpositive divisor", program: { language: "python3", code: "print(0)" } }],
	timeLimitMs: 1000,
	memoryLimitMb: 256,
	analysis:
		"Output any positive divisor of n. Independent solutions choose opposite divisors. Checker verifies range, divisibility and absence of extra tokens.",
} satisfies HydroAuthoringProject;
