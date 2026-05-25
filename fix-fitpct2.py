with open('src/main.ts', 'r') as f:
    content = f.read()

old = "Math.max(0, Math.min(100, 100 - ((c.params['rawErr'] as number) ?? c.err) * 100).toFixed(1)}"
new = "Math.max(0, Math.min(100, 100 - ((c.params['rawErr'] as number) ?? c.err) * 100)).toFixed(1)"
content = content.replace(old, new)

with open('src/main.ts', 'w') as f:
    f.write(content)

# Verify
with open('src/main.ts', 'r') as f:
    for i, line in enumerate(f, 1):
        if 'Fit:' in line and 'rawErr' in line:
            print(f'Line {i}: {line.rstrip()}')
            break
