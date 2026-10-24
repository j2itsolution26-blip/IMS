"""Rewrites named top-level functions to use the store-scoped client.

usage: scope_fn.py FILE [--import] FUNC [FUNC ...]

For each FUNC (a top-level `function NAME(` or `const NAME = ...`), inserts
`const db = await storeDb();` as the first statement and replaces `prisma.`
with `db.` inside that function only. `--import` swaps the prisma import for
the storeDb import.
"""
import re
import sys

path = sys.argv[1]
args = sys.argv[2:]
s = open(path, encoding='utf-8').read()

if '--import' in args:
    args.remove('--import')
    m = re.search(r"^import \{ ([^}]*) \} from '@/lib/prisma';\n", s, re.M)
    assert m, 'prisma import not found'
    names = [n.strip() for n in m.group(1).split(',')]
    rest = [n for n in names if n != 'prisma']
    repl = "import { storeDb } from '@/lib/tenant/context';\n"
    if rest:
        repl = f"import {{ {', '.join(rest)} }} from '@/lib/prisma';\n" + repl
    s = s[:m.start()] + repl + s[m.end():]

for name in args:
    m = re.search(r'^(export )?(async )?function %s[<(]|^(export )?const %s\b' % (re.escape(name), re.escape(name)), s, re.M)
    assert m, f'{name} not found'
    start = m.start()
    # end of the top-level declaration
    ends = [i for i in (s.find('\n}\n', start), s.find('\n});\n', start), s.find('\n};\n', start)) if i != -1]
    end = min(ends)
    body = s[start:end]
    # first line that opens the function body
    om = re.search(r'(\) \{|=> \{|> \{)\n', body)
    assert om, f'{name}: body start not found'
    insert_at = om.end()
    nxt = body[insert_at:]
    indent = re.match(r'[ ]*', nxt).group(0) or '  '
    assert 'prisma.' in body or 'prisma,' in body or 'prisma)' in body, f'{name}: no prisma use'
    new_body = body[:insert_at] + f'{indent}const db = await storeDb();\n' + re.sub(r'\bprisma\b(?=[.,)])', 'db', nxt)
    s = s[:start] + new_body + s[end:]

open(path, 'w', encoding='utf-8', newline='').write(s)
print('ok', path)
