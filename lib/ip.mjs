// Small shared helpers for the optional LAN IP override.

/** @param {unknown} value
 *  @returns {boolean} */
export function isValidIpv4(value) {
  const m = String(value ?? '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m !== null && m.slice(1).every((part) => {
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

/**
 * 主机名（含 DDNS 域名，如 home.hs.net）：RFC 1123 宽松式——
 * 点分标签，每段 [a-z0-9]（可带内部连字符，不以连字符开头/结尾），总长 ≤ 253。
 * 不含端口/空白/协议前缀；IPv4 也满足此形状，但 override 匹配按字符串比较，
 * 语义上无冲突（Host 头的 IPv4 字面量同样原样比较）。
 * @param {unknown} value
 * @returns {boolean} */
export function isValidHostname(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v.length === 0 || v.length > 253) return false;
  // 纯数字加点的形态一律按「IPv4 意图」对待：合法 IPv4 走 isValidIpv4，
  // 打错的（999.1.1.1、999.1.1）绝不当主机名放行——否则用户写错 IP 会被
  // 静默存成一个谁也匹配不上的"域名"。
  if (/^[0-9.]+$/.test(v)) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(v);
}

/** override 允许形态：IPv4 或点分主机名。 */
/** @param {unknown} value @returns {boolean} */
export function isValidOverrideHost(value) {
  return isValidIpv4(value) || isValidHostname(value);
}
