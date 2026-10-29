// 会话密钥持久化（回归测试）：确保 dsh web 重启后已登录设备**不会**被强制重登。
//
// 背景：旧实现用 randomBytes(16) 在进程内生成 sessionKey，登录 cookie 的值是
// sha256(PIN:sessionKey)。进程一重启 sessionKey 就变，所有设备的 cookie 立刻失配，
// 用户被弹回登录页——即使他设的是「永久密码」。用户观感就是「永久密码隔天失效」。
// 修复：sessionKey 落盘复用；改密码 / 恢复出厂时才 rotateSessionKey() 主动作废。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dshp-sk-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      if (prev === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prev;
      rmSync(dir, { recursive: true, force: true });
    });
}

const keyPath = (dir) => join(dir, 'dsh-pocket', 'session-key');

test('sessionKey 落盘：同一 DSH_HOME 下重复读取得到同一个密钥（重启不失配）', () => withHome(async (dir) => {
  const { rotateSessionKey } = await import('../lib/index.js');
  const first = rotateSessionKey();
  assert.equal(existsSync(keyPath(dir)), true, '密钥文件应已写入');
  assert.match(first, /^[0-9a-f]{64}$/, '密钥为 64 位十六进制');

  // 模拟「另一个进程/重启后」读取：文件内容就是权威值，未被重写。
  const onDisk = readFileSync(keyPath(dir), 'utf8').trim();
  assert.equal(onDisk, first, '磁盘内容即当前会话密钥');

  // 再次 apply 前读取同一文件 → 值不变（持久化，不是每次随机）
  assert.equal(readFileSync(keyPath(dir), 'utf8').trim(), first, '重复读取仍是同一密钥');
}));

test('rotateSessionKey 主动轮换：值改变且落盘（用于改密码/恢复出厂踢设备）', () => withHome(async (dir) => {
  const { rotateSessionKey } = await import('../lib/index.js');
  const a = rotateSessionKey();
  const b = rotateSessionKey();
  assert.notEqual(a, b, '显式轮换应产生新密钥');
  assert.equal(readFileSync(keyPath(dir), 'utf8').trim(), b, '新密钥已落盘');
}));

test('密钥文件权限为 0600（不泄露给同机其他用户）', () => withHome(async (dir) => {
  const { rotateSessionKey } = await import('../lib/index.js');
  rotateSessionKey();
  const mode = statSync(keyPath(dir)).mode & 0o777;
  assert.equal(mode, 0o600, `期望 0600，实际 ${mode.toString(8)}`);
}));

test('损坏/空的密钥文件会被替换成合法值，不让插件崩', () => withHome(async (dir) => {
  const { rotateSessionKey } = await import('../lib/index.js');
  rotateSessionKey();
  // 写一个明显非法的值，模拟磁盘损坏/半截写入
  writeFileSync(keyPath(dir), 'not-a-hex-key!!\n');
  const fresh = rotateSessionKey();
  assert.match(fresh, /^[0-9a-f]{64}$/, '轮换后仍是合法密钥');
}));
