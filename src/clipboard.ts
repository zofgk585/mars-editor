/**
 * 富文本剪贴板复制：同时写入 text/html 与 text/plain，
 * 这样粘贴进微信公众平台编辑器（UEditor 内核）时内联样式被完整保留。
 */

/** 复制前剥离预览专用标记（data-line / data-tip 对文章无意义，公众号会原样保留多余属性） */
export function stripPreviewMeta(html: string): string {
  return html.replace(/ data-line="\d+"/g, '').replace(/ data-tip(?=[ >])/g, '');
}

/** 块级元素（转纯文本时需要补换行） */
const BLOCK_SELECTOR = 'p,div,section,h1,h2,h3,h4,h5,h6,li,tr,pre,pre code,blockquote,hr,table';

/**
 * HTML → 纯文本。
 *
 * DOMParser 产出的文档不参与排版，innerText 会退化成 textContent，
 * 整篇会被挤成一行；这里显式给块级元素补换行，纯文本粘贴才有段落。
 */
function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.body.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.append('\n'));
  return (doc.body.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 复制富文本到剪贴板，返回是否成功 */
export async function copyRichText(html: string): Promise<boolean> {
  const clean = stripPreviewMeta(html);
  const plain = htmlToPlainText(clean);

  // 优先：现代 ClipboardItem API（Chrome 76+ / Edge，微信后台常用浏览器）
  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([clean], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    } catch {
      // fallthrough 到 execCommand
    }
  }

  // 回退：隐藏 contenteditable 容器 + execCommand('copy')
  return copyViaExecCommand(clean);
}

function copyViaExecCommand(html: string): boolean {
  const container = document.createElement('div');
  container.setAttribute('contenteditable', 'true');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.innerHTML = html;
  document.body.appendChild(container);

  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  document.body.removeChild(container);
  return ok;
}
