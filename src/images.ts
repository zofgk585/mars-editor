/**
 * 图片工具：把本地图片文件缩放到指定尺寸内并转为 data URL，
 * 内嵌进 markdown 实现本地预览。
 */
export function downscaleImage(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建画布');
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        // PNG 保留透明通道；其余转 JPEG 压缩
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, quality));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

/**
 * 批量注册图片文件：逐张降采样后调用 onAdd(name, dataUrl)。
 * 返回成功/失败的文件名，便于插入 ![[name]] 或提示。
 */
export async function registerImageFiles(
  files: File[],
  onAdd: (name: string, dataUrl: string) => void,
): Promise<{ names: string[]; failures: string[] }> {
  const names: string[] = [];
  const failures: string[] = [];
  for (const f of files) {
    try {
      const dataUrl = await downscaleImage(f);
      onAdd(f.name, dataUrl);
      names.push(f.name);
    } catch (err) {
      console.warn('图片处理失败', f.name, err);
      failures.push(f.name);
    }
  }
  return { names, failures };
}
