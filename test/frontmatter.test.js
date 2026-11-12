import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../lib/frontmatter.js';

test('parses scalar fields and strips quotes', () => {
  const fm = parseFrontmatter('---\nname: my-skill\ndescription: "A test skill"\nversion: 1.2.0\n---\n# Body\n');
  assert.equal(fm.fields.name, 'my-skill');
  assert.equal(fm.fields.description, 'A test skill');
  assert.equal(fm.fields.version, '1.2.0');
  assert.match(fm.body, /# Body/);
});

test('returns undefined without frontmatter or without closing marker', () => {
  assert.equal(parseFrontmatter('# no frontmatter\n'), undefined);
  assert.equal(parseFrontmatter('---\nname: x\n'), undefined);
});

test('handles CRLF and keeps first occurrence of duplicate keys', () => {
  const fm = parseFrontmatter('---\r\nname: a\r\nname: b\r\n---\r\nbody');
  assert.equal(fm.fields.name, 'a');
});

test('readFrontmatter reads a file', async () => {
  const { readFrontmatter } = await import('../lib/frontmatter.js');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'sc-fm-'));
  await writeFile(join(dir, 'SKILL.md'), '---\nname: f\ndescription: d\n---\nx');
  assert.equal((await readFrontmatter(join(dir, 'SKILL.md'))).fields.name, 'f');
  assert.equal(await readFrontmatter(join(dir, 'missing.md')), undefined);
});

test('strips single-quoted values and pins empty-value semantics', () => {
  const fm = parseFrontmatter("---\nname: 'quoted skill'\ndescription:\nversion: ''\n---\n");
  assert.equal(fm.fields.name, 'quoted skill');
  assert.equal(fm.fields.description, '');
  assert.equal(fm.fields.version, '');
});
