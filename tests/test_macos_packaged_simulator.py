#!/usr/bin/env python3
"""Verify a relocated packaged simulator uses only its bundled SDL libraries."""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

root = pathlib.Path(sys.argv[1]).resolve()
source = root / 'build'
simulator = source / 'amoled-simulator'
sdl2 = source / 'libSDL2-2.0.0.dylib'
sdl3 = source / 'libSDL3.dylib'
for path in (simulator, sdl2, sdl3):
    if not path.is_file():
        raise SystemExit(f'missing packaged runtime dependency: {path}')

def tool(*args):
    return subprocess.check_output(args, text=True)

links = tool('otool', '-L', str(simulator))
assert '@rpath/libSDL2-2.0.0.dylib' in links, links
assert '/opt/homebrew/' not in links and '/usr/local/' not in links, links
for path in (sdl2, sdl3):
    identity = tool('otool', '-D', str(path))
    assert f'@rpath/{path.name}' in identity, identity
    deps = '\n'.join(tool('otool', '-L', str(path)).splitlines()[2:])
    assert '/opt/homebrew/' not in deps and '/usr/local/' not in deps, deps
assert '@executable_path' in tool('otool', '-l', str(simulator))

with tempfile.TemporaryDirectory(prefix='amoled-relocated-') as temp:
    relocated = pathlib.Path(temp)
    for path in (simulator, sdl2, sdl3):
        shutil.copy2(path, relocated / path.name)
    env = {key: value for key, value in os.environ.items() if not key.startswith('DYLD_')}
    env.update(HOME=temp, SDL_VIDEODRIVER='dummy', SDL_RENDER_DRIVER='software', DYLD_PRINT_LIBRARIES='1')
    result = subprocess.run([str(relocated / simulator.name), '--smoke'], cwd=temp, env=env,
                            capture_output=True, text=True, timeout=20)
    log = result.stdout + result.stderr
    assert result.returncode == 0, log
    assert str(relocated / sdl2.name) in log, log
    assert str(relocated / sdl3.name) in log, log
    assert '/opt/homebrew/' not in log and '/usr/local/' not in log, log
print('relocated simulator: bundled SDL2 and SDL3 loaded, dummy-video smoke passed')
