import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PROMPTS, PROMPT_META, renderPrompt, renderTemplate, PromptRenderError } from '../server/src/prompts/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASELINE: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(HERE, 'fixtures', 'prompts-baseline.json'), 'utf8'),
);

test('提示词数量与基线一致（16 条）', () => {
  assert.equal(Object.keys(BASELINE).length, 16);
  assert.deepEqual(Object.keys(PROMPTS).sort(), Object.keys(BASELINE).sort());
});

test('每条提示词与改造前逐字符一致', () => {
  for (const [id, expected] of Object.entries(BASELINE)) {
    assert.equal(PROMPTS[id], expected, `提示词 ${id} 与基线不一致`);
  }
});

test('无变量模板渲染后与原文完全相同', () => {
  for (const id of Object.keys(BASELINE) as (keyof typeof PROMPT_META)[]) {
    assert.equal(renderPrompt(id), BASELINE[id], `渲染 ${id} 后与原文不一致`);
  }
});

test('渲染器：占位符替换、缺变量报错、无残留', () => {
  assert.equal(renderTemplate('前缀 {{a}} 后缀', { a: 'X' }), '前缀 X 后缀');

  assert.throws(
    () => renderTemplate('需要 {{a}} 与 {{b}}', { a: '1' }),
    (err: unknown) => err instanceof PromptRenderError && err.missing.includes('b'),
  );

  // frontmatter 声明的变量缺失也要报错
  assert.throws(
    () => renderTemplate('无占位符', {}, ['declared']),
    (err: unknown) => err instanceof PromptRenderError && err.missing.includes('declared'),
  );

  // 多余变量被忽略，不污染输出
  assert.equal(renderTemplate('{{a}}', { a: 'ok', extra: 'ignored' }), 'ok');

  // 未知 id 直接报错，不返回空串
  assert.throws(() => renderPrompt('not-exist' as never), /未知提示词/);
});

test('prompts/*.md 与 generated.ts 保持同步', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-prompts.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('提示词正文已从调用点移除（ai.ts / agent.ts）', () => {
  const forbidden = ['你是一位资深中文网络小说作家', '你是「起笔」智能长篇小说创作软件的', '7 Gate 门禁系统'];
  for (const rel of ['server/src/routes/ai.ts', 'server/src/agent.ts']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const f of forbidden) {
      assert.ok(!src.includes(f), `${rel} 仍包含提示词正文片段：${f}`);
    }
  }
});
