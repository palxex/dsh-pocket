// 登录自愈（回归测试）：确保「密码正确」永远不会被陈旧 cookie 或限速静默拦掉。
//
// 两个历史 bug，都表现为「输入正确密码却一直说密码错误，重试也没用」：
//   1) maybeSeedAuthCookie 只看「有没有 dsh_pocket_token 这个 key」就跳过签发。
//      浏览器残留任何旧值（过期 / 换了 sessionKey / 来自同域另一个实例）时，
//      带正确 ?token= 进来也拿不到新 cookie → 永远停在登录页。
//   2) POST 登录在比对密码**之前**就判锁定并 429。一旦失败计数被攒满
//      （旧 cookie 让正确密码反复被判失败），正确密码也被一律挡住。
// 本测试从源码层面锁死这两处语义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/proxy.mjs', import.meta.url), 'utf8');

test('cookie 播种：已有 cookie 但值不匹配时必须覆盖（不得只因 key 存在就跳过）', () => {
  const seg = src.slice(src.indexOf('function maybeSeedAuthCookie'), src.indexOf('function maybeSeedAuthCookie') + 2200);
  assert.ok(seg.length > 100, '应能定位到 maybeSeedAuthCookie');
  // 必须是「相等才跳过」，不能是「存在就跳过」
  assert.match(seg, /=== *expected\) *return/, '应按值相等判断是否跳过签发');
  assert.ok(
    !/if *\( *parseCookies\([^)]*\)\[TOKEN_COOKIE\] *\) *return/.test(seg),
    '不得保留「只要存在 cookie 就 return」的旧写法（会让正确密码被陈旧 cookie 顶掉）',
  );
});

test('POST 登录：先校验密码，正确则无视锁定放行', () => {
  const start = src.indexOf("req.url?.startsWith('/pocket-login')");
  assert.ok(start > 0, '应能定位到 POST 登录分支');
  const seg = src.slice(start, start + 1400);
  // 在 matched 命中之前，不应出现基于 locked 的提前 return
  const matchedAt = seg.indexOf('const matched =');
  assert.ok(matchedAt > 0, '应能定位到密码比对');
  const before = seg.slice(0, matchedAt);
  assert.ok(
    !/if *\([^)]*\.locked\)[\s\S]*?return/.test(before),
    '密码比对之前不得因锁定提前 return（否则正确密码会被限速拦住）',
  );
  // 命中后必须 clear 计数
  const after = seg.slice(matchedAt);
  assert.match(after, /limiter\?\.clear\(ip\)/, '密码命中后应清空该 IP 的失败计数');
});

test('错误提交仍计入限速（穷举防线不得被削弱）', () => {
  const start = src.indexOf("req.url?.startsWith('/pocket-login')");
  const seg = src.slice(start, start + 1600);
  assert.match(seg, /limiter\?\.record\(ip\)/, '错误提交必须 record，保留穷举防护');
});

test('登录页含陈旧 cookie 自愈脚本（可删除坏 cookie）', () => {
  const page = src.slice(src.indexOf('function loginPageHtml'), src.indexOf('function loginPageHtml') + 9000);
  assert.match(page, /Max-Age=0/, '登录页应能把坏 cookie 置为过期');
  assert.match(page, /dsh_pocket_token/, '自愈脚本应针对 pocket 会话 cookie');
});
