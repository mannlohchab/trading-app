#!/usr/bin/env python3
"""Exercise Compose's real env_file decoder without contacting a Docker engine.

Fixtures use Dokploy 0.31.1's prepareEnvironmentVariablesForFile encoding:
https://github.com/Dokploy/dokploy/blob/v0.31.1/packages/server/src/utils/docker/utils.ts
Only temporary files and deliberately fake values are used.
"""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent

# Literal encoded fixtures avoid coupling the check to an implementation of
# Dokploy's serializer. Quotes delimit values; backslashes, quotes and literal
# dollars inside values are escaped by Dokploy before writing the file.
DOKPLOY_ENV = r'''PORT="4001"
AI_PROVIDER="openrouter"
BACKEND_IMAGE="example.invalid/trading-backend:environment-test"
BACKTEST_SANDBOX="bwrap"
FIXTURE_BACKSLASH="C:\\market\\candles\\2026.csv"
FIXTURE_QUOTES="He said \"buy\"; she's waiting"
FIXTURE_DOLLARS="cost \$5; \$BUN_FIXTURE_UNEXPECTED; \$\$ end"
FIXTURE_BACKSLASH_DOLLAR="literal \\\$ticker"
FIXTURE_EQUALS="key=value=more"
FIXTURE_BLANK=""
FIXTURE_WHITESPACE="  padded # value  "
'''

EXPECTED = {
    'PORT': '4001',
    'AI_PROVIDER': 'openrouter',
    'BACKEND_IMAGE': 'example.invalid/trading-backend:environment-test',
    'BACKTEST_SANDBOX': 'bwrap',
    'FIXTURE_BACKSLASH': r'C:\market\candles\2026.csv',
    'FIXTURE_QUOTES': 'He said "buy"; she\'s waiting',
    'FIXTURE_DOLLARS': 'cost $5; $BUN_FIXTURE_UNEXPECTED; $$ end',
    'FIXTURE_BACKSLASH_DOLLAR': r'literal \$ticker',
    'FIXTURE_EQUALS': 'key=value=more',
    'FIXTURE_BLANK': '',
    'FIXTURE_WHITESPACE': '  padded # value  ',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def resolve(docker, compose_file, directory, environment):
    result = subprocess.run([
        docker, 'compose', '--project-name', 'trading-env-regression',
        '--project-directory', str(directory), '--env-file', str(directory / '.env'),
        '-f', str(compose_file), 'config', '--format', 'json',
    ], env=environment, capture_output=True, text=True, timeout=30)
    require(result.returncode == 0,
            f'Docker Compose configuration failed: {result.stderr.strip()}')
    return json.loads(result.stdout)['services']['backend']


def validate():
    docker = shutil.which('docker')
    require(docker is not None, 'Docker CLI with the Compose plugin is required')
    compose = (ROOT / 'compose.yml').read_text()
    env_path_line = r'(?m)^([ \t]*)- path: \.env[ \t]*$'
    require(len(re.findall(env_path_line, compose)) == 1,
            'Expected exactly one .env entry in the deployment Compose file')

    environment = os.environ.copy()
    for key in list(environment):
        if key in EXPECTED or key.startswith('COMPOSE_'):
            del environment[key]
    # If literal dollars are accidentally interpolated, make the failure visible.
    environment['BUN_FIXTURE_UNEXPECTED'] = 'UNEXPECTED_INTERPOLATION'
    environment['ticker'] = 'UNEXPECTED_TICKER_INTERPOLATION'

    with tempfile.TemporaryDirectory(prefix='trading-compose-env-') as temporary:
        directory = Path(temporary)
        (directory / '.env').write_text(DOKPLOY_ENV)
        compose_file = directory / 'compose.yml'
        compose_file.write_text(compose)
        resolved = resolve(docker, compose_file, directory, environment)
        actual = resolved['environment']
        # config re-escapes every literal dollar after resolving the model, even
        # for JSON, so its output can be read as another Compose document. Compare
        # to that exact representation rather than stripping characters from the
        # output and potentially hiding an interpolation error.
        # https://github.com/docker/compose/blob/v2.40.3/cmd/compose/config.go#L173
        mismatches = [key for key, value in EXPECTED.items()
                      if actual.get(key) != value.replace('$', '$$')]
        require(not mismatches,
                'Dokploy environment values were changed by Compose: ' + ', '.join(mismatches))
        require(resolved['image'] == EXPECTED['BACKEND_IMAGE'],
                'Image interpolation did not decode the Dokploy environment file')

        # Negative control reproduces the production regression: format: raw
        # preserves Dokploy's surrounding quotes instead of decoding the values.
        raw_compose, replacements = re.subn(
            env_path_line, r'\1- path: .env\n\1  format: raw', compose,
        )
        require(replacements == 1, 'Could not construct the raw-format negative control')
        raw_file = directory / 'compose-raw.yml'
        raw_file.write_text(raw_compose)
        raw = resolve(docker, raw_file, directory, environment)['environment']
        require(raw.get('PORT') == '"4001"' and raw.get('AI_PROVIDER') == '"openrouter"',
                'Raw-format negative control no longer reproduces the quoted-value regression')

    print('PASS: deployment Compose decodes Dokploy values, including $, backslashes and quotes')
    print('PASS: raw-format negative control reproduces the PORT/AI_PROVIDER regression')
    print('No Docker engine, network, production environment or container was used.')


if __name__ == '__main__':
    try:
        validate()
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
