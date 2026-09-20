/**
 * 长图导出：把渲染好的正文画成一张 PNG（发朋友圈 / 存档用）。
 *
 * 不引 html2canvas 之类的库 —— 本项目的正文样式全部内联、图片全是 data URI，
 * 正好满足 `<foreignObject>` 的要求：把真实 DOM 用 XMLSerializer 序列化成
 * 合法 XHTML 塞进 SVG，再当图片画到 canvas 上。XMLSerializer 会自动闭合
 * `<img>` / `<br>` 这类空元素并转义属性，手写字符串拼接做不到这一点。
 */

import { extractTitle, stripFirstH1 } from './markdown';
import { st, type Theme } from './theme';

/** 版面宽度（CSS px）：按手机正文宽度排版，导出时再放大 */
const WIDTH = 375;
const PADDING = 20;
/** 输出倍率：2 倍 ≈ 750px 宽，与公众号截图习惯一致 */
const SCALE = 2;
/** canvas 单边上限，超过就降倍率（浏览器再高会直接画不出来） */
const MAX_DEVICE_PX = 30000;

interface Options {
  /** renderArticle().body —— 已内联样式的正文 HTML */
  body: string;
  theme: Theme;
  /** 文章头署名，留空则不画作者行 */
  author?: string;
}

/** 等正文里的图片全部解码完，否则量出来的高度是错的 */
async function waitForImages(root: HTMLElement): Promise<void> {
  const pending = Array.from(root.querySelectorAll('img')).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
  );
  await Promise.all(pending);
  // 字体没加载完会按后备字体量高度，导出后文字位置会偏
  if (document.fonts?.ready) await document.fonts.ready;
}

/** 文章头（标题 + 作者行），风格跟预览里的文章头一致 */
function headHtml(title: string, theme: Theme, author?: string): string {
  const dateText = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const meta = author ? `${author} · ${dateText}` : dateText;
  return `<div style="${st({ 'margin-bottom': '20px' })}">
    <div style="${st({
      'font-family': theme.heading.font,
      'font-size': '22px',
      'font-weight': '700',
      'line-height': '1.4',
      color: theme.heading.color,
    })}">${title}</div>
    <div style="${st({
      'margin-top': '10px',
      'font-size': '13px',
      color: theme.footnote.textColor,
    })}">${meta}</div>
  </div>`;
}

/**
 * 渲染长图，返回 PNG Blob。
 * 文章过长（放大后超出 canvas 上限）时先降倍率，还是超就抛错。
 */
export async function renderLongImage({ body, theme, author }: Options): Promise<Blob> {
  const title = extractTitle(body);
  const bg = theme.body.bg ?? '#ffffff';

  const stage = document.createElement('div');
  stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;opacity:0;pointer-events:none;z-index:-1`;

  const card = document.createElement('div');
  card.style.cssText = st({
    width: `${WIDTH}px`,
    'box-sizing': 'border-box',
    padding: `${PADDING}px`,
    background: bg,
    'font-family': theme.body.font,
    'font-size': theme.body.fontSize,
    'line-height': theme.body.lineHeight,
    color: theme.body.color,
    'word-break': 'break-word',
  });
  card.innerHTML = (title ? headHtml(title, theme, author) : '') + (title ? stripFirstH1(body) : body);

  stage.appendChild(card);
  document.body.appendChild(stage);

  try {
    await waitForImages(card);
    const height = Math.ceil(card.getBoundingClientRect().height);
    if (height <= 0) throw new Error('正文为空');

    let scale = SCALE;
    if (height * scale > MAX_DEVICE_PX) scale = 1;
    if (height * scale > MAX_DEVICE_PX) {
      throw new Error(`文章过长（约 ${height}px），超出浏览器画布上限，建议分篇导出`);
    }

    const xhtml = new XMLSerializer().serializeToString(card);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('长图渲染失败'));
      img.src = src;
    });

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布');
    // SVG 是矢量的，直接按目标尺寸绘制即可保持文字清晰（不是先画小再放大）
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('长图编码失败');
    return blob;
  } finally {
    stage.remove();
  }
}
