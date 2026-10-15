// bundle 装载身份一致性（回归测试）。
//
// 背景：包名从 dsh-pocket 改成 @palxex/dsh-pocket 后，cordis.patch.yml 里的
// name 没跟着改，仍是旧的无作用域名。cordis 在 profile 里解析不到该模块时
// **静默丢弃整个插件**——设置页 tab 和客户端 bundle 一起消失，没有任何报错。
// 排查代价很大（浏览器 Network 里 86 个插件 bundle 独缺本插件）。
//
// 本测试锁死这条不变量：patch 的 name 必须等于 package.json 的 name，
// 且必须能被 profile 解析成真实模块。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');

/** 极简 YAML 解析：只取 `- insert:` 下列表项的 id / name，不引入 YAML 依赖。 */
function parseInsertEntries(text) {
  const entries = [];
  let inInsert = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (/^-?\s*insert:\s*$/.test(line)) { inInsert = true; continue; }
    if (!inInsert) continue;
    const idMatch = /^\s*-\s*id:\s*(.+?)\s*$/.exec(line);
    if (idMatch) { entries.push({ id: strip(idMatch[1]) }); continue; }
    const nameMatch = /^\s*name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch && entries.length > 0) { entries[entries.length - 1].name = strip(nameMatch[1]); continue; }
    // insert 列表结束：遇到非缩进的顶级 key
    if (/^\S/.test(line) && line !== '') break;
  }
  return entries;
}

const strip = (v) => v.trim().replace(/^['"]|['"]$/g, '');

test('cordis.patch：patch 的 name 必须等于 package.json 的 name', () => {
  const entries = parseInsertEntries(patchText);
  assert.ok(entries.length >= 1, 'cordis.patch.yml 应至少插入一个 entry');
  for (const e of entries) {
    assert.equal(
      e.name,
      pkg.name,
      `patch entry "${e.id}" 的 name (${e.name}) 必须等于包名 (${pkg.name})——` +
        '不一致时 cordis 解析不到模块会静默丢弃整个插件（设置页 tab 消失）',
    );
  }
});

test('cordis.patch：name 不得是无作用域的旧名（改名后最易漏的一处）', () => {
  const entries = parseInsertEntries(patchText);
  for (const e of entries) {
    assert.notEqual(
      e.name,
      'dsh-pocket',
      'patch name 仍是旧的无作用域名 dsh-pocket；包名已改为 @palxex/dsh-pocket，' +
        'profile 里不存在 dsh-pocket 模块，插件会整体不加载',
    );
  }
});

test('bundle 身份三处一致：package.json name / patch name / 目录名约定', () => {
  const entries = parseInsertEntries(patchText);
  const scoped = pkg.name.startsWith('@');
  if (scoped) {
    assert.match(pkg.name, /^@[^/]+\/[^/]+$/, 'scoped 包名格式应为 @scope/name');
    for (const e of entries) {
      assert.ok(e.name.startsWith('@'), `scoped 包 "${pkg.name}" 的 patch name 也必须是 scoped`);
    }
  }
});

test('client bundle 的 __ModuleLoader__ id 必须等于包名', () => {
  // 服务端按包名请求 `<pkg>/client.js`；bundle 以别的 id 注册时客户端会报
  // `import failed: client-modules: could not load "<pkg>"`，设置页 tab 不出现。
  // 对照 @palxex/dsh-plugin-mesh：其 id 即完整包名。
  const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  const m = /__ModuleLoader__\s*\.\s*load\s*\(\s*\{\s*id:\s*(["'])(.+?)\1/.exec(bundle);
  assert.ok(m, 'client/client.js 应含 window.__ModuleLoader__.load({ id: ... })');
  assert.equal(
    m[2],
    pkg.name,
    `bundle loader id (${m[2]}) 必须等于包名 (${pkg.name})——` +
      '不一致时客户端报 "could not load" 且设置页 tab 不出现',
  );
});

test('build.mjs 的 loader id 由 package.json 推导，不写死旧名', () => {
  const build = readFileSync(new URL('../client/build.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(
    build,
    /DSH_POCKET_CLIENT_ID\s*\?\?\s*['"]dsh-pocket['"]/,
    'build.mjs 不应把 loader id 兜底写死为旧名 dsh-pocket；应从 package.json.name 推导',
  );
  assert.match(build, /pkg\.name/, 'build.mjs 应以 package.json 的 name 作为 loader id 来源');
});
