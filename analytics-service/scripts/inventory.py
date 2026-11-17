#!/usr/bin/env python3
"""Collect literal analytics call sites from a named Git revision, never payloads.

Usage: inventory.py CHECKOUT REV PATH_PREFIX [...]
The output contains names/locations only; it does not inspect environment files.
Computed event names require a separate manual contract review.
"""
import json
import re
import subprocess
import sys

checkout, revision, *prefixes = sys.argv[1:]
def git(*args):
    return subprocess.check_output(['git', '-C', checkout, *args], text=True)

commit = git('rev-parse', revision).strip()
pattern = re.compile(r'\b(?:track|trackEvent|time_event)\s*\(\s*([\'\"])([^\'\"\n]+)\1')
sites = []
for path in git('ls-tree', '-r', '--name-only', commit, '--', *prefixes).splitlines():
    if not path.endswith(('.js', '.ts', '.tsx', '.jsx', '.swift')):
        continue
    if re.search(r'\.(test|spec)\.|/(tests|fixtures|vendor|node_modules)/', path):
        continue
    source = git('show', f'{commit}:{path}')
    for match in pattern.finditer(source):
        sites.append({'event': match.group(2), 'path': path, 'line': source.count('\n', 0, match.start()) + 1})
print(json.dumps({'revision': commit, 'scope': prefixes, 'method': 'Literal track/trackEvent/time_event calls; excludes tests. Computed names require manual review.', 'eventNames': sorted({site['event'] for site in sites}), 'callSites': sites}, indent=2))
