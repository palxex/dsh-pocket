// 隧道事实判定（回归测试）。
//
// 用户诉求：没开公网访问时，任何入口都不该被当成公网、要求一把 UI 里
// 根本不显示的公网 PIN（home.hs.net 这类 DDNS 域名场景）。
//
// 实现：policyHost 注入 tunnelRunning 探针——探针返回 false 时，
// LAN/loopback 源的 public Host 按源地址降级为局域网语义；探针返回
// true 或不可用（未注入）时维持旧「只收紧」语义。经 service 层接线：
// tunnelRunningSync() = tunnel !== null || startTunnel 在途。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const { createPocketProxy } = await import('../lib/proxy.mjs');
const { createPocketService } = await import('../lib/service.mjs');

const http = await import('node:http');

test('service 接线：createPocketProxy 收到 tunnelRunning 探针', async () => {
  let seen = null;
  const fakeProxy = { listen: () => {}, close: async () => {}, address: () => ({ port: 1 }) };
  const svc = createPocketService({
    dshPort: 1, port: 0,
    internals: {
      createProxy: (opts) => { seen = opts; return Promise.resolve(fakeProxy); },
      lanIPv4: async () => '10.0.0.5',
      lanCandidates: async () => ['10.0.0.5'],
    },
    auth: { getToken: () => 'x', isProtected: () => true, sessionKey: 'k' },
    getLanEnabled: () => true,
    getLanIpOverride: () => '',
  });
  await svc.startProxy();
  assert.equal(typeof seen?.tunnelRunning, 'function', 'service 必须把探针传给 proxy');
  assert.equal(seen.tunnelRunning(), false, '未启动隧道 → false');
  await svc.dispose?.().catch(() => {});
});

test('端到端：隧道未开时 DDNS 域名入口用 LAN PIN 登录、文案不再「公网」', async () => {
  const LAN = 'palfan11';
  const up = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>dsh</body></html>'); });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const proxy = await createPocketProxy({
    port: 0, host: '127.0.0.1',
    upstream: { host: '127.0.0.1', port: up.address().port },
    auth: {
      // 模拟 index.js：getToken 按 Host 分类，public→公网 PIN（本测试里 00000000）
      getToken: (host) => (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(:\d+)?$/i.test(host) ? '00000000' : LAN),
      isProtected: () => true,
      sessionKey: 'sk',
    },
    tunnelRunning: () => false, // 隧道未开
  });
  const login = (pin, hostHeader) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: proxy.port, method: 'POST', path: '/pocket-login',
      headers: { Host: hostHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write('token=' + pin);
    req.end();
  });
  try {
    // 本机测试 socket 是 loopback 源 + home.hs.net（public Host）+ 隧道关 → 降级 LAN 语义
    const ok = await login(LAN, 'home.hs.net:3082');
    assert.equal(ok.status, 302, '隧道未开：DDNS 域名 + LAN PIN 登录成功');
    const bad = await login('00000000', 'home.hs.net:3082');
    assert.equal(bad.status, 200, '公网 PIN 不再被接受（已降级为局域网）');
    assert.ok(bad.body.includes('此局域网地址'), '登录页文案为「局域网」而非「公网」');
  } finally {
    await proxy.close();
    await new Promise((r) => up.close(r));
  }
});

test('端到端：隧道运行中 DDNS 域名入口维持公网 PIN（绝不放松）', async () => {
  const up = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const proxy = await createPocketProxy({
    port: 0, host: '127.0.0.1',
    upstream: { host: '127.0.0.1', port: up.address().port },
    auth: {
      getToken: (host) => (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(:\d+)?$/i.test(host) ? 'WAN-PIN' : 'LAN-PIN'),
      isProtected: () => true,
      sessionKey: 'sk',
    },
    tunnelRunning: () => true,
  });
  const login = (pin) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: proxy.port, method: 'POST', path: '/pocket-login',
      headers: { Host: 'home.hs.net:3082', 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') })); });
    req.on('error', reject);
    req.write('token=' + pin);
    req.end();
  });
  try {
    assert.equal((await login('LAN-PIN')).status, 200, '隧道开：LAN PIN 被拒');
    assert.equal((await login('WAN-PIN')).status, 302, '隧道开：公网 PIN 通过');
  } finally {
    await proxy.close();
    await new Promise((r) => up.close(r));
  }
});

test('守卫：service 把 tunnelRunningSync 接进 createPocketProxy（接线不可漏）', () => {
  const src = readFileSync(new URL('../lib/service.mjs', import.meta.url), 'utf8');
  assert.match(src, /tunnelRunning: tunnelRunningSync/, 'service 必须注入探针');
  const proxySrc = readFileSync(new URL('../lib/proxy.mjs', import.meta.url), 'utf8');
  const wired = proxySrc.match(/policyHost\(req, String\(req\.headers\.host \?\? ''\), \{ tunnelRunning \}\)/g) ?? [];
  assert.equal(wired.length, 2, 'HTTP 与 WS 两处入口都必须把探针传给 policyHost');
});
