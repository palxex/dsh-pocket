# 移动端缩放兜底（mobile-zoom-guard）

## 这是什么

pocket 会在经代理返回的 HTML `<head>` 里注入一段内容，用来**禁用移动端的用户
缩放**（尤其是 iOS 的双击放大、局部触摸放大），避免在手机上点两下某个位置就被
放大，干扰 PWA 使用体验。

注入内容（见 `lib/proxy.mjs` 的 `MOBILE_ZOOM_GUARD_INJECT`，并包含在
`DEFAULT_INJECT` 中）：

1. 一个 `viewport` meta：
   `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`
2. 一小段双击守卫脚本：在 350ms 内连续两次 `touchstart` 时 `preventDefault()`，
   拦截浏览器的双击放大手势（多指捏合不拦，交由 viewport 的 `user-scalable=no`
   处理）。

注入点在 `<head>` 之后、DSH 自己的 `viewport` meta 之前；浏览器取文档中**第一个**
`viewport` meta，因此本兜底生效。

## 为什么需要这个兜底

DSH webui 自身的 `viewport` meta 是：

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

它**没有** `user-scalable=no` / `maximum-scale=1`，于是浏览器默认的用户缩放
（iOS 双击放大、局部触摸放大）处于开启状态。这是 **DSH 侧尚未处理**的事项，不是
pocket 引入的问题。在 DSH 处理之前，pocket 以注入方式做临时兜底。

## 维护提醒（给后续维护者 / AI）

**这是一个临时兜底，不是永久设计。** 当 DSH 已经自行处理了「禁用移动端用户
缩放」时，应当**移除本注入**，避免重复、避免长期背负「改 DSH UI」的耦合。

### 判断 DSH 是否已处理

检查 DSH 侧是否满足以下任一条件：

1. DSH 的 `viewport` meta 已包含 `user-scalable=no` 或 `maximum-scale=1`；
   （典型位置：DSH 的 HTML 模板，如 `dsh-web-frontend` 的 `index.html`）
2. DSH 在全局层面禁用了双击放大 / 用户缩放（例如全局 `touch-action` 或
   双击守卫脚本）。

检查方式（示例）：

```bash
# 看 DSH 返回的 HTML 的 viewport
curl -s http://127.0.0.1:3080/ | grep -i '<meta[^>]*viewport[^>]*>'
# 若已含 user-scalable=no / maximum-scale=1，说明 DSH 已处理
```

### 若 DSH 已处理：移除兜底

1. 删除 `lib/proxy.mjs` 中的 `MOBILE_ZOOM_GUARD_INJECT` 常量，并从
   `DEFAULT_INJECT` 中移除它；
2. 删除本文档；
3. 重新构建客户端（`node client/build.mjs`，若涉及）并回归测试。

### 若 DSH 仍未处理

保持现状。不要自行扩展注入范围——本兜底只做「禁用用户缩放」这一件事，避免重演
此前 pocket 覆写 DSH 移动 UI 的耦合问题。

## 关联

- 注入实现：`lib/proxy.mjs` → `MOBILE_ZOOM_GUARD_INJECT` / `DEFAULT_INJECT`
- 判断标准以 DSH 上游的实际行为为准，而非 pocket 的猜测。
