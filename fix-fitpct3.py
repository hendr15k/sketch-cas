with open('src/main.ts', 'r') as f:
    lines = f.readlines()

# Line 373 (0-indexed: 372)
line = lines[372]
print("BEFORE:", repr(line))

# The actual content has escaped quotes like \"
# Fix: move .toFixed(1) outside the Math.max
line = line.replace(
    '100).toFixed(1)}%',
    '100)).toFixed(1)}%'
)

print("AFTER:", repr(line))
lines[372] = line

with open('src/main.ts', 'w') as f:
    f.writelines(lines)
