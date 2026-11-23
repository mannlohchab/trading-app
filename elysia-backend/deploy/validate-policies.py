#!/usr/bin/env python3
"""Offline integrity and syntax checks; never load AppArmor into the kernel."""

import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
PINNED_HASHES = {
    'moby-seccomp-default.json': '3320527d4568265ac97a077609b1bfd4cfd0d789eeb9239b7e094b1526675406',
    'moby-apparmor-template.go': '3e10fd44140c527b01c70fb0e79b05c1f9a128b9b31a59c9627b497b8dfba475',
    'LICENSE.moby': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate():
    for name, expected in PINNED_HASHES.items():
        actual = hashlib.sha256((ROOT / 'upstream' / name).read_bytes()).hexdigest()
        require(actual == expected, f'Pinned upstream hash mismatch: {name}')

    upstream = json.loads((ROOT / 'upstream/moby-seccomp-default.json').read_text())
    current = json.loads((ROOT / 'seccomp.json').read_text())
    original_rules = upstream.pop('syscalls')
    current_rules = current.pop('syscalls')
    require(current == upstream, 'Seccomp top-level settings changed')
    require(current_rules[:len(original_rules)] == original_rules,
            'An upstream seccomp rule changed')
    additions = [{k: v for k, v in rule.items() if k != 'comment'}
                 for rule in current_rules[len(original_rules):]]
    namespace_mask = 0x81FDFFFF
    namespace_argument = {
        'index': 0, 'value': namespace_mask, 'valueTwo': 0,
        'op': 'SCMP_CMP_MASKED_EQ',
    }
    clone_argument = {**namespace_argument, 'valueTwo': 17}
    require(additions == [
        {'names': ['mount', 'umount2', 'pivot_root', 'chroot'], 'action': 'SCMP_ACT_ALLOW'},
        {'names': ['unshare'], 'action': 'SCMP_ACT_ALLOW', 'args': [namespace_argument]},
        {'names': ['clone'], 'action': 'SCMP_ACT_ALLOW', 'args': [clone_argument],
         'excludes': {'arches': ['s390', 's390x']}},
        {'names': ['clone'], 'action': 'SCMP_ACT_ALLOW',
         'args': [{**clone_argument, 'index': 1}],
         'includes': {'arches': ['s390', 's390x']}},
    ], 'Seccomp additions differ from the reviewed syscall/argument allowlist')

    template = (ROOT / 'upstream/moby-apparmor-template.go').read_text()
    profile = (ROOT / 'trading-elysia-sandbox.apparmor').read_text()

    def denies(text):
        return {line.split('#', 1)[0].strip() for line in text.splitlines()
                if line.strip().startswith('deny ')}

    system_paths = json.loads((ROOT / 'docker-system-paths.json').read_text())
    require(system_paths['maskedPaths'] == [
        '/proc/acpi', '/proc/asound', '/proc/interrupts', '/proc/kcore',
        '/proc/keys', '/proc/latency_stats', '/proc/sched_debug', '/proc/scsi',
        '/proc/timer_list', '/proc/timer_stats', '/sys/devices/virtual/powercap',
        '/sys/firmware',
    ], 'Reviewed Docker masked paths changed')
    require(system_paths['readonlyPaths'] == [
        '/proc/bus', '/proc/fs', '/proc/irq', '/proc/sys', '/proc/sysrq-trigger',
    ], 'Reviewed Docker readonly paths changed')
    path_denies = {f'deny {path}{{,/**}} rwklx,' for path in system_paths['maskedPaths']}
    path_denies |= {f'deny {path}{{,/**}} wklx,' for path in system_paths['readonlyPaths']}
    require(denies(profile) == (denies(template) - {'deny mount,'}) | path_denies,
            'AppArmor denies differ from upstream plus the reviewed system-path protections')
    profile_lines = {line.strip() for line in profile.splitlines()
                     if line.strip() and not line.lstrip().startswith('#')}
    require({'userns,', 'mount,', 'pivot_root,', 'network unix,', 'abi <abi/4.0>,'}
            <= profile_lines, 'AppArmor namespace/ABI rules missing')
    require('profile trading-elysia-sandbox flags=(attach_disconnected,mediate_deleted) {'
            in profile_lines, 'AppArmor profile name or flags changed')
    require(not re.search(r'flags\s*=\s*\([^)]*\b(?:unconfined|complain)\b', profile),
            'AppArmor must remain enforcing')

    parser = shutil.which('apparmor_parser')
    require(parser is not None, 'apparmor_parser is required for offline syntax validation')
    subprocess.run([
        parser, '--skip-kernel-load', '--skip-read-cache', '--skip-cache',
        str(ROOT / 'trading-elysia-sandbox.apparmor'),
    ], check=True)
    print('PASS: pinned sources, exact seccomp changes, AppArmor denies and offline syntax')
    print('No policy was loaded. Target-host container isolation still requires verification.')


if __name__ == '__main__':
    try:
        validate()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
