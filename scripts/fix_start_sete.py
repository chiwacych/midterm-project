#!/usr/bin/env python3
"""Fix [ -z ... ] && patterns that are incompatible with set -e in bash."""
import re

path = '/home/ubuntu/medimage/start.sh'
with open(path, 'r') as f:
    c = f.read()

old_count = len(re.findall(r'\[ -z ', c))

# Fix: [ -z "$PEER_ID" ] && continue  ->  if [ -z "$PEER_ID" ]; then continue; fi
c = c.replace('[ -z "$PEER_ID" ] && continue', 'if [ -z "$PEER_ID" ]; then continue; fi')

# Fix: [ -z "$PEER_IP" ] && PEER_IP=...  ->  if [ -z "$PEER_IP" ]; then PEER_IP=...; fi
# Match lines like: [ -z "$PEER_IP" ] && PEER_IP=$(getent hosts ...)
lines = c.split('\n')
new_lines = []
for line in lines:
    m = re.match(r'^(\s*)\[ -z "\$PEER_IP" \] && (PEER_IP=.*)$', line)
    if m:
        indent = m.group(1)
        assignment = m.group(2)
        new_lines.append(f'{indent}if [ -z "$PEER_IP" ]; then {assignment}; fi')
    else:
        new_lines.append(line)
c = '\n'.join(new_lines)

new_count = len(re.findall(r'\[ -z ', c))
with open(path, 'w') as f:
    f.write(c)

print(f'Done. [ -z count: {old_count} -> {new_count}')
