import { createHash } from 'node:crypto';

export type Pair = [string, string | number];
export interface Soul {
  id: string; suit: string; suitId: number; pos: number; quality: number; level: number;
  main: Pair; sub: Record<string, number>; fixed: Pair | null;
  rolls: Pair[]; wornBy: string; locked: boolean; discarded: boolean;
}
export interface Listing {
  server: string; order: string; url: string; name: string; serverName: string;
  role: string | null; price: number | null; captured: number;
  souls: Soul[]; heroes: Record<string, unknown>; fingerprint: string;
}
export const conversionVersion = 'inventory-v1';
export function hash(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const rollTypes: Record<string, [string, number]> = {
  speedAdditionVal: ['速度', 3], attackAdditionVal: ['攻击', 27], defenseAdditionVal: ['防御', 5],
  maxHpAdditionVal: ['生命', 114], critRateAdditionVal: ['暴击', 3], critPowerAdditionVal: ['暴击伤害', 4],
  maxHpAdditionRate: ['生命加成', 3], defenseAdditionRate: ['防御加成', 3], attackAdditionRate: ['攻击加成', 3],
  debuffEnhance: ['效果命中', 4], debuffResist: ['效果抵抗', 4]
};
// All percentages in the local model use percentage points (15 means 15%).
// Use the unrounded rolls only when they agree with the published two-decimal display.
function subAttributes(display: Pair[], rolls: Pair[]) {
  const precise: Record<string, number> = {};
  for (const [code, coefficient] of rolls) {
    const mapping = rollTypes[code];
    if (mapping) precise[mapping[0]] = (precise[mapping[0]] ?? 0) + Number(coefficient) * mapping[1];
  }
  const sub: Record<string, number> = {};
  for (const [label, value] of display) {
    const rounded = parseFloat(String(value));
    if (!Number.isFinite(rounded)) throw new Error('御魂副属性数值无效');
    sub[label] = Math.abs(rounded - precise[label]) <= 0.005001 ? precise[label] : rounded;
  }
  return sub;
}
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function decode(raw: Buffer, fallbackTime: number): Listing {
  const envelope = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  const equip = envelope.equip ?? envelope.equip_data;
  if (Number(envelope.status) !== 1 || !record(equip)) throw new Error('文件不是成功的藏宝阁商品详情');
  const server = String(equip.serverid ?? equip.server_id ?? '');
  const order = String(equip.game_ordersn || equip.ordersn || equip.equip_sn || '');
  if (!/^\d+$/.test(server) || !/^[\w-]+$/.test(order)) throw new Error('缺少服务器 ID 或商品编号');
  const desc = typeof equip.equip_desc === 'string' ? JSON.parse(equip.equip_desc) : equip.equip_desc;
  if (!record(desc) || !record(desc.inventory)) throw new Error('缺少御魂库存 inventory');
  const souls: Soul[] = Object.entries(desc.inventory).map(([id, item]) => {
    if (!record(item) || (item.uuid && item.uuid !== id) || !Array.isArray(item.attrs) ||
        !item.attrs.length || !Array.isArray(item.rattr) || !Number.isInteger(item.pos) ||
        item.pos < 1 || item.pos > 6 || !item.name || !Number.isFinite(item.suitid) ||
        !Number.isFinite(parseFloat(item.attrs[0]?.[1]))) throw new Error('御魂记录缺少有效属性或位置');
    return { id, suit: item.name, suitId: item.suitid, pos: item.pos, quality: item.qua, level: item.level,
      main: item.attrs[0], sub: subAttributes(item.attrs.slice(1), item.rattr),
      fixed: item.single_attr ?? null, rolls: item.rattr, wornBy: String(item.herouid ?? ''),
      locked: !!item.lock, discarded: !!item.isuseless };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const heroes = desc.heroes ?? {};
  if (!record(heroes)) throw new Error('式神记录格式无效');
  const fingerprint = hash(canonical([conversionVersion, souls, heroes]));
  const captureText = String(envelope.server_now_time ?? '');
  const date = /^\d{4}-\d{2}-\d{2} \d\d:\d\d:\d\d$/.test(captureText)
    ? Date.parse(captureText.replace(' ', 'T') + '+08:00') : NaN;
  const role = [desc.roleid, desc.role_id, equip.roleid, equip.role_id].find(x =>
    (typeof x === 'string' || Number.isSafeInteger(x)) && /^[1-9]\d*$/.test(String(x)));
  return { server, order, url: `https://yys.cbg.163.com/cgi/mweb/equip/${server}/${order}`,
    name: String(equip.equip_name || desc.name || order), serverName: String(equip.server_name || server),
    role: role == null ? null : String(role), price: Number.isSafeInteger(equip.price) ? equip.price : null,
    captured: Number.isFinite(date) ? date : Math.trunc(fallbackTime), souls, heroes, fingerprint };
}
