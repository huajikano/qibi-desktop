// 从 prompts/**/*.md 生成 server/src/prompts/generated.ts
// 用法：npm run prompts:build（--check 只校验不写入）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PROMPTS_DIR = path.join(ROOT, 'prompts');
const OUT = path.join(ROOT, 'server', 'src', 'prompts', 'generated.ts');
const STAGES = new Set(['generation', 'polish', 'review', 'planning', 'agent', 'mcp']);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`缺少 frontmatter: ${file}`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  const body = m[2].replace(/\n$/, '');
  const id = meta.id;
  if (!id) throw new Error(`缺少 id: ${file}`);
  if (path.basename(file, '.md') !== id) throw new Error(`文件名与 id 不一致: ${file} (id=${id})`);
  if (!STAGES.has(meta.stage)) throw new Error(`非法 stage "${meta.stage}": ${file}`);
  const vars = /^\[(.*)\]$/.exec(meta.variables || '[]')?.[1].split(',').map(s => s.trim()).filter(Boolean) ?? [];
  return { id, stage: meta.stage, version: Number(meta.version || 1), variables: vars, text: body };
}

export function build() {
  const items = walk(PROMPTS_DIR).map(parse).sort((a, b) => a.id.localeCompare(b.id));
  const dup = items.map(i => i.id).filter((v, i, a) => a.indexOf(v) !== i);
  if (dup.length) throw new Error('重复 id: ' + dup.join(','));

  const meta = items.map(i =>
    `  ${JSON.stringify(i.id)}: { version: ${i.version}, stage: ${JSON.stringify(i.stage)}, variables: ${JSON.stringify(i.variables)} as string[] },`
  ).join('\n');
  const body = items.map(i => `  ${JSON.stringify(i.id)}: ${JSON.stringify(i.text)},`).join('\n');
  return `// 由 scripts/build-prompts.mjs 生成，勿手工编辑。源：prompts/**/*.md
export const PROMPT_META = {
${meta}
} as const;

export const PROMPTS: Record<string, string> = {
${body}
};
`;
}

const out = build();
const check = process.argv.includes('--check');
if (check) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== out) { console.error('generated.ts 与 prompts/*.md 不一致，请运行 npm run prompts:build'); process.exit(1); }
  console.log('prompts:check OK');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`prompts:build OK (${out.split('\n').length} 行)`);
}

