import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 首屏必需、且几乎不变的依赖 —— 单独成块，换版本才失效，日常发版能一直命中缓存。
 * 注意：只列核心包。@codemirror/lang-* 与 legacy-modes 是 @codemirror/language-data
 * 按需动态加载的语法（构建产物里那一百多个小 chunk），
 * 一旦被归进固定块就会全部变成首屏同步依赖。
 */
const VENDOR_GROUPS: Record<string, string[]> = {
  react: ['react', 'react-dom', 'scheduler'],
  // 图标集几乎不随业务改动，单独成块常驻缓存
  icons: ['@phosphor-icons/react'],
  codemirror: [
    '@codemirror/state',
    '@codemirror/view',
    '@codemirror/commands',
    '@codemirror/search',
    '@codemirror/autocomplete',
    '@codemirror/language',
    '@codemirror/lang-markdown',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    '@lezer/markdown',
    'style-mod',
    'w3c-keyname',
    'crelt',
  ],
  markdown: [
    'markdown-it',
    'markdown-it-footnote',
    'markdown-it-mark',
    'linkify-it',
    'mdurl',
    'uc.micro',
    'entities',
    'punycode.js',
  ],
};

/** node_modules 路径 → 所属分组（按包名精确匹配，避免误伤 lang-* 这类同前缀包） */
function vendorChunk(id: string): string | undefined {
  const m = id.split('node_modules/').pop();
  if (!m) return undefined;
  const pkg = m.startsWith('@') ? m.split('/').slice(0, 2).join('/') : m.split('/')[0];
  for (const [group, pkgs] of Object.entries(VENDOR_GROUPS)) {
    if (pkgs.includes(pkg)) return group;
  }
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // 语法高亮与编辑器语法包都已按需加载，剩下的主包应远低于该阈值
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules') ? vendorChunk(id) : undefined),
      },
    },
  },
});
