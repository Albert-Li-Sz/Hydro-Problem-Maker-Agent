/** Runs inside the disposable Linux container; only JSON crosses its stdin/stdout boundary. */
export const sandboxProcessRunner = `
import json, math, os, pathlib, resource, shutil, signal, subprocess, sys, time

payload = json.load(sys.stdin)
output_limit = 1024 * 1024
root = pathlib.Path('/work')

def execute(command, input_text, timeout, memory_mb, directory):
    directory.mkdir(exist_ok=True, parents=True)
    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (output_limit, output_limit))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (math.ceil(timeout) + 1, math.ceil(timeout) + 1))
        if memory_mb is not None:
            size = memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (size, size))
    started = time.monotonic()
    with open(directory / 'stdin', 'wb') as file:
        file.write(input_text.encode('utf-8'))
    with open(directory / 'stdin', 'rb') as stdin, open(directory / 'stdout', 'wb') as stdout, open(directory / 'stderr', 'wb') as stderr:
        process = subprocess.Popen(command, stdin=stdin, stdout=stdout, stderr=stderr, cwd=directory,
            env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/tmp'},
            start_new_session=True, preexec_fn=limits)
        status = 'ok'
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            status = 'time_limit'
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
    out = (directory / 'stdout').read_bytes()[:output_limit]
    err = (directory / 'stderr').read_bytes()[:output_limit]
    shutil.rmtree(directory, ignore_errors=True)
    if status == 'ok' and (len(out) >= output_limit or len(err) >= output_limit):
        status = 'output_limit'
    elif status == 'ok' and process.returncode != 0:
        status = 'runtime_error'
    return {'status': status, 'stdout': out.decode('utf-8', errors='replace'),
        'stderr': err.decode('utf-8', errors='replace'), 'exitCode': process.returncode,
        'durationMs': round((time.monotonic() - started) * 1000)}
`;

export const sandboxRunner = `${sandboxProcessRunner}
program = payload['program']
language = program['language']
limit = payload['timeLimitMs'] / 1000
memory = payload['memoryLimitMb']
filename = {'cpp17': 'main.cpp', 'python3': 'main.py', 'java': 'Main.java'}[language]
(root / filename).write_text(program['code'], encoding='utf-8')

compile_command = {
    'cpp17': ['g++', '-std=c++17', '-O2', '-pipe', str(root / filename), '-o', '/work/main'],
    'python3': ['python3', '-m', 'py_compile', str(root / filename)],
    'java': ['javac', '-J-Xmx256m', str(root / filename)]
}[language]
compile_result = execute(compile_command, '', 30, None, root / 'compile')
result = {'compiled': compile_result['status'] == 'ok',
    'compileOutput': compile_result['stderr'] + compile_result['stdout'], 'cases': []}
if result['compiled']:
    command = {
        'cpp17': ['/work/main'],
        'python3': ['python3', '-I', '/work/main.py'],
        'java': ['java', '-Xmx' + str(memory) + 'm', '-XX:ActiveProcessorCount=1', '-XX:+UseSerialGC', '-XX:CompressedClassSpaceSize=32m', '-XX:ReservedCodeCacheSize=32m', '-cp', '/work', 'Main']
    }[language]
    for index, case in enumerate(payload['cases']):
        item = execute(command, case['input'], limit, None if language == 'java' else memory, root / ('case-' + str(index)))
        item['index'] = index
        result['cases'].append(item)
print(json.dumps(result, ensure_ascii=False))
`;
