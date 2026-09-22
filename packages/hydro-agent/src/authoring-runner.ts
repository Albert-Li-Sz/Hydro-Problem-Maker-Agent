import { sandboxProcessRunner } from "./sandbox-runner.ts";

/** One container compiles each authoring component once, then materializes and verifies the data. */
export const authoringRunner =
	sandboxProcessRunner +
	String.raw`
output_limit = 16 * 1024 * 1024
checks, data = [], []
commands = {}
languages = {}
total_bytes = 0
mode = payload.get('verificationMode', 'full')

def record(stage, passed, message='', case_id=None):
    checks.append({'stage': stage, 'caseId': case_id, 'passed': passed, 'message': message[:4000]})
    return passed

def detail(run):
    return run['status'] + ': ' + (run['stderr'] or run['stdout'])[:3500]

def compile_program(role, program):
    directory = root / role
    directory.mkdir()
    lang = program['language']
    languages[role] = lang
    source = directory / {'cpp17': 'main.cpp', 'python3': 'main.py', 'java': 'Main.java'}[lang]
    source.write_text(program['code'], encoding='utf-8')
    compile_cmd = {
        'cpp17': ['g++', '-std=c++17', '-O2', '-pipe', '-I/opt/testlib', str(source), '-o', str(directory / 'main')],
        'python3': ['python3', '-m', 'py_compile', str(source)],
        'java': ['javac', '-J-Xmx256m', str(source)]
    }[lang]
    compiled = execute(compile_cmd, '', 40, None, directory / 'compile')
    commands[role] = {
        'cpp17': [str(directory / 'main')],
        'python3': ['python3', '-I', str(source)],
        'java': ['java', '-XX:ActiveProcessorCount=1', '-XX:+UseSerialGC', '-XX:CompressedClassSpaceSize=32m',
                 '-XX:ReservedCodeCacheSize=32m', '-cp', str(directory), 'Main']
    }[lang]
    return record('compile:' + role, compiled['status'] == 'ok', detail(compiled))

def run_program(role, text, directory, timeout=5, memory=512, args=None):
    cmd = commands[role][:]
    if languages[role] == 'java':
        cmd.insert(1, '-Xmx' + str(memory) + 'm')
    return execute(cmd + (args or []), text, timeout,
                   None if languages[role] == 'java' else memory, directory)

def normalized(text):
    lines = [line.rstrip(' \t') for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n')]
    while lines and lines[-1] == '':
        lines.pop()
    return lines

def judge(text, answer, contestant, directory):
    if not payload.get('checker'):
        return ('accepted' if normalized(answer) == normalized(contestant) else 'rejected', '')
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in [('input', text), ('answer', answer), ('contestant', contestant)]:
        (directory / name).write_text(content, encoding='utf-8')
    result = run_program('checker', '', directory / 'run', args=[str(directory / 'input'), str(directory / 'contestant'), str(directory / 'answer')])
    shutil.rmtree(directory, ignore_errors=True)
    # _fail, crashes, timeout, output-limit and partial scores are infrastructure errors, never a valid WA.
    if result['status'] == 'ok' and result['exitCode'] == 0 and result['stderr'].startswith('ok'):
        return ('accepted', result['stderr'])
    if result['status'] == 'runtime_error' and result['exitCode'] in (1, 2) and result['stderr'].startswith(('wrong answer', 'wrong output format')):
        return ('rejected', result['stderr'])
    return ('error', detail(result))

def main():
    global total_bytes
    programs = {'reference': payload['reference'], 'oracle': payload['oracle'],
                'generator': {'language': 'cpp17', 'code': payload['generator']},
                'validator': {'language': 'cpp17', 'code': payload['validator']}}
    if payload.get('checker'):
        programs['checker'] = {'language': 'cpp17', 'code': payload['checker']}
    for index, item in enumerate(payload['wrongPrograms']):
        programs['wrong-' + str(index)] = item['program']
    for role, program in programs.items():
        if not compile_program(role, program):
            return
    invalid_inputs = payload['invalidInputs'] if mode == 'full' else payload['invalidInputs'][:8]
    for index, text in enumerate(invalid_inputs):
        invalid = run_program('validator', text, root / ('invalid-' + str(index)))
        record('validator-negative', invalid['status'] == 'runtime_error' and invalid['exitCode'] == 3
               and invalid['stderr'].startswith('FAIL'), detail(invalid), str(index + 1))
    killed = set()
    cases = payload['cases']
    if mode == 'quick':
        preferred = [case for case in cases if case.get('purpose') == 'sample' or case.get('oracle')]
        cases = (preferred + [case for case in cases if case not in preferred])[:8]
    for case in cases:
        case_id = case['id']
        directory = root / ('case-' + case_id)
        directory.mkdir()
        text = case.get('input', '')
        if 'generatorArgs' in case:
            gen = run_program('generator', '', directory / 'generate', args=case['generatorArgs'])
            if not record('generator', gen['status'] == 'ok',
                          ('ok: ' + str(len(gen['stdout'].encode('utf-8'))) + ' bytes') if gen['status'] == 'ok' else detail(gen), case_id):
                continue
            text = gen['stdout']
            repeated = run_program('generator', '', directory / 'repeat', args=case['generatorArgs'])
            if not record('reproducibility', repeated['status'] == 'ok' and repeated['stdout'] == text,
                          '固定参数重跑一致' if repeated['status'] == 'ok' and repeated['stdout'] == text else detail(repeated), case_id):
                continue
        valid = run_program('validator', text, directory / 'validate')
        if not record('validator', valid['status'] == 'ok', 'ok' if valid['status'] == 'ok' else detail(valid), case_id):
            continue
        time_ms = case.get('timeLimitMs', payload['timeLimitMs'])
        memory = case.get('memoryLimitMb', payload['memoryLimitMb'])
        ref = run_program('reference', text, directory / 'reference', time_ms / 1000, memory)
        if not record('reference', ref['status'] == 'ok',
                      ('ok: ' + str(len(ref['stdout'].encode('utf-8'))) + ' bytes, ' + str(ref['durationMs']) + ' ms') if ref['status'] == 'ok' else detail(ref), case_id):
            continue
        answer = ref['stdout']
        verdict, message = judge(text, answer, answer, directory / 'self-check')
        if not record('checker-self', verdict == 'accepted', message, case_id):
            continue
        if 'expectedOutput' in case:
            verdict, message = judge(text, case['expectedOutput'], answer, directory / 'sample-check')
            reverse, reverse_message = judge(text, answer, case['expectedOutput'], directory / 'sample-reverse')
            record('sample', verdict == 'accepted' and reverse == 'accepted', message + reverse_message or ('expected: ' + case['expectedOutput'][:500] + '\nactual: ' + answer[:500]), case_id)
        if case.get('oracle'):
            oracle = run_program('oracle', text, directory / 'oracle', 10, 512)
            if record('oracle-run', oracle['status'] == 'ok',
                      ('ok: ' + str(len(oracle['stdout'].encode('utf-8'))) + ' bytes') if oracle['status'] == 'ok' else detail(oracle), case_id):
                verdict, message = judge(text, oracle['stdout'], answer, directory / 'oracle-check')
                reverse, reverse_message = judge(text, answer, oracle['stdout'], directory / 'oracle-reverse')
                record('oracle', verdict == 'accepted' and reverse == 'accepted', message or reverse_message or
                       ('reference: ' + answer[:500] + '\noracle: ' + oracle['stdout'][:500]), case_id)
        for index, item in enumerate(payload['wrongPrograms']):
            if index in killed:
                continue
            wrong = run_program('wrong-' + str(index), text, directory / ('wrong-' + str(index)), time_ms / 1000, memory)
            if wrong['status'] != 'ok':
                killed.add(index)
                record('wrong-program-killed', True, item['name'] + ': ' + detail(wrong), case_id)
            else:
                verdict, message = judge(text, answer, wrong['stdout'], directory / ('wrong-check-' + str(index)))
                if verdict == 'error':
                    record('checker-error', False, message, case_id)
                elif verdict == 'rejected':
                    killed.add(index)
                    record('wrong-program-killed', True, item['name'] + ': ' + message, case_id)
        for index, probe in enumerate(payload.get('checkerProbes', [])):
            if probe['caseId'] != case_id:
                continue
            verdict, message = judge(text, answer, probe['output'], directory / ('probe-' + str(index)))
            record('checker-probe', verdict == ('accepted' if probe['accept'] else 'rejected'), probe['description'] + ': ' + message, case_id)
        total_bytes += len(text.encode('utf-8')) + len(answer.encode('utf-8'))
        if total_bytes > 64 * 1024 * 1024:
            record('data-size', False, '本次制题数据总量超过 64 MiB。', case_id)
            return
        data.append({'id': case_id, 'input': text, 'output': answer, 'durationMs': ref['durationMs'],
                     'timeLimitMs': time_ms, 'memoryLimitMb': memory})
        shutil.rmtree(directory)
    if mode == 'full':
        for index, item in enumerate(payload['wrongPrograms']):
            if index not in killed:
                record('wrong-program-survived', False, item['name'] + ': 所有测试点均通过，需要加强数据。')

try:
    main()
except Exception as error:
    record('infrastructure', False, str(error))
expected_cases = len(payload['cases']) if mode == 'full' else min(8, len(payload['cases']))
print(json.dumps({'success': len(data) == expected_cases and all(item['passed'] for item in checks),
                  'mode': mode, 'checks': checks, 'cases': data}, ensure_ascii=False))
`;
