/**
 * 编辑器 → 预览的滚动同步通道。
 *
 * 刻意不走 React state：滚动每帧都可能触发，若经由 setState 会让整棵组件树
 * 陪着重渲染一次，既慢又会把跟随动作切成一格一格。这里用一个可变对象直接传值，
 * 预览侧订阅后在 rAF 里读取并写 DOM，React 完全不参与滚动路径。
 */
export interface ScrollSyncState {
  /**
   * 编辑器顶部对应的源码位置。
   * 整数部分是 0-based 行号（与渲染出的 data-line 对齐），
   * 小数部分是「在这一行块内滚过的比例」—— 有了它预览才能连续跟随，
   * 而不是等整行翻过去才跳一次。
   */
  position: number;
  /**
   * 编辑器滚到底时的 position。
   *
   * 最后一个锚点之后没有下一个锚点可插值，预览会一直停在那儿、直到「到底」
   * 时硬跳到底部 —— 表现就是临近结尾突然蹦一大段、看着像漏内容。
   * 把「文末」当成一个虚拟锚点（endPosition → 预览最大滚动量），
   * 尾段就能连续插值过去，两端还正好对齐。
   */
  endPosition: number;
  /** 编辑器已滚到顶 / 底（用于边界精确对齐，避免插值误差留下缝隙） */
  atTop: boolean;
  atBottom: boolean;
}

export interface ScrollSyncChannel {
  /** 当前状态（可变对象，读取时总是最新值） */
  readonly state: ScrollSyncState;
  /** 编辑器侧：发布新位置并通知订阅者 */
  publish(next: ScrollSyncState): void;
  /** 预览侧：订阅变化，返回取消订阅函数 */
  subscribe(fn: () => void): () => void;
}

export function createScrollSyncChannel(): ScrollSyncChannel {
  const state: ScrollSyncState = { position: 0, endPosition: 0, atTop: true, atBottom: false };
  const listeners = new Set<() => void>();
  return {
    state,
    publish(next) {
      state.position = next.position;
      state.endPosition = next.endPosition;
      state.atTop = next.atTop;
      state.atBottom = next.atBottom;
      for (const fn of listeners) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
