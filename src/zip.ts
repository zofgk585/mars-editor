/**
 * 最小 ZIP 读写（备份导出 / 导入用）。
 *
 * 不引第三方库：压缩交给浏览器原生的 CompressionStream('deflate-raw')，
 * 拿不到时退回 store（不压缩）——两种都是标准 zip，系统解压工具能直接打开。
 * 读取侧同时支持 store 与 deflate，所以用 Finder / 资源管理器重新打包过的
 * 备份文件也能导回来。
 */

export interface ZipEntry {
  /** zip 内路径，如 `drafts/我的文章.md` */
  name: string;
  data: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** 通用位标记 bit 11：文件名按 UTF-8 编码（中文名必需） */
const FLAG_UTF8 = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** JS Date → DOS 时间/日期字段（zip 头里的老格式，2 秒精度） */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function streamBytes(data: Uint8Array, transform: 'deflate-raw', mode: 'c' | 'd'): Promise<Uint8Array> {
  const Ctor = mode === 'c' ? CompressionStream : DecompressionStream;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new Ctor(transform));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** deflate 压缩；浏览器不支持或压不小就返回 null（改用 store） */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const out = await streamBytes(data, 'deflate-raw', 'c');
    return out.length < data.length ? out : null;
  } catch {
    return null;
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压，请用 Chrome / Edge 打开');
  }
  return streamBytes(data, 'deflate-raw', 'd');
}

/** 打包成 zip Blob */
export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  const { time, date } = dosDateTime(new Date());
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const deflated = await deflateRaw(entry.data);
    const body = deflated ?? entry.data;
    const method = deflated ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true); // 解压所需版本
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local as BlobPart, body as BlobPart);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true); // 打包版本
    cv.setUint16(6, 20, true); // 解压所需版本
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // 对应本地头偏移
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + body.length;
  }

  const cdSize = central.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...(central as BlobPart[]), eocd as BlobPart], { type: 'application/zip' });
}

/** 解包 zip；目录项自动跳过 */
export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // 中央目录尾在文件末尾，注释最长 65535，从后往前找签名
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== CENTRAL_SIG) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // 目录项没有内容
    if (dv.getUint32(localOffset, true) !== LOCAL_SIG) continue;
    // 本地头里的名称 / 扩展字段长度可能与中央目录不同，必须按本地头算数据起点
    const start = localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
    const raw = buf.subarray(start, start + compSize);
    if (method !== 0 && method !== 8) throw new Error(`不支持的压缩方式（${name}）`);
    out.push({ name, data: method === 8 ? await inflateRaw(raw) : raw.slice() });
  }

  return out;
}
