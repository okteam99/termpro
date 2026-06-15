import { describe, expect, it, vi } from 'vitest';
import { wireWebglAtlasResync } from '../webglAtlasResync';

/** 最小假 WebglAddon:可手动 emit remove/change 事件,记录订阅是否被 dispose。 */
function makeFakeWebgl() {
  const removeListeners = new Set<() => void>();
  const changeListeners = new Set<() => void>();
  const addListeners = new Set<() => void>();
  return {
    onRemoveTextureAtlasCanvas(l: () => void) {
      removeListeners.add(l);
      return { dispose: () => removeListeners.delete(l) };
    },
    onChangeTextureAtlas(l: () => void) {
      changeListeners.add(l);
      return { dispose: () => changeListeners.delete(l) };
    },
    // 故意暴露 add 事件:用于断言 wire 不订阅它(增页不重排索引,订阅会刷新风暴)
    onAddTextureAtlasCanvas(l: () => void) {
      addListeners.add(l);
      return { dispose: () => addListeners.delete(l) };
    },
    emitRemove() {
      for (const l of removeListeners) l();
    },
    emitChange() {
      for (const l of changeListeners) l();
    },
    get removeCount() {
      return removeListeners.size;
    },
    get changeCount() {
      return changeListeners.size;
    },
    get addCount() {
      return addListeners.size;
    },
  };
}

const flushMicrotasks = () => Promise.resolve();

describe('wireWebglAtlasResync', () => {
  it('删页(合并)事件后整屏重绘 refresh(0, rows-1)', async () => {
    const webgl = makeFakeWebgl();
    const term = { rows: 24, refresh: vi.fn() };
    wireWebglAtlasResync(webgl, term);

    webgl.emitRemove();
    expect(term.refresh).not.toHaveBeenCalled(); // 微任务前不同步触发
    await flushMicrotasks();

    expect(term.refresh).toHaveBeenCalledTimes(1);
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
  });

  it('换图集事件也触发重绘', async () => {
    const webgl = makeFakeWebgl();
    const term = { rows: 10, refresh: vi.fn() };
    wireWebglAtlasResync(webgl, term);

    webgl.emitChange();
    await flushMicrotasks();

    expect(term.refresh).toHaveBeenCalledTimes(1);
    expect(term.refresh).toHaveBeenCalledWith(0, 9);
  });

  it('一帧内多次图集变更去抖为一次 refresh', async () => {
    const webgl = makeFakeWebgl();
    const term = { rows: 30, refresh: vi.fn() };
    wireWebglAtlasResync(webgl, term);

    webgl.emitRemove();
    webgl.emitRemove();
    webgl.emitChange();
    await flushMicrotasks();

    expect(term.refresh).toHaveBeenCalledTimes(1);
  });

  it('去抖窗口结束后,新一轮变更再次触发 refresh', async () => {
    const webgl = makeFakeWebgl();
    const term = { rows: 5, refresh: vi.fn() };
    wireWebglAtlasResync(webgl, term);

    webgl.emitRemove();
    await flushMicrotasks();
    webgl.emitRemove();
    await flushMicrotasks();

    expect(term.refresh).toHaveBeenCalledTimes(2);
  });

  it('rows=0 时 refresh 端点不为负', async () => {
    const webgl = makeFakeWebgl();
    const term = { rows: 0, refresh: vi.fn() };
    wireWebglAtlasResync(webgl, term);

    webgl.emitRemove();
    await flushMicrotasks();

    expect(term.refresh).toHaveBeenCalledWith(0, 0);
  });

  it('不订阅 onAddTextureAtlasCanvas(增页不重排索引 · 锁定设计意图)', async () => {
    const webgl = makeFakeWebgl();
    const term = { rows: 20, refresh: vi.fn() };
    wireWebglAtlasResync(webgl, term);

    expect(webgl.addCount).toBe(0);
  });

  it('stop() 解除订阅,后续事件不再重绘', async () => {
    const webgl = makeFakeWebgl();
    const term = { rows: 12, refresh: vi.fn() };
    const stop = wireWebglAtlasResync(webgl, term);

    expect(webgl.removeCount).toBe(1);
    expect(webgl.changeCount).toBe(1);

    stop();
    expect(webgl.removeCount).toBe(0);
    expect(webgl.changeCount).toBe(0);

    webgl.emitRemove();
    webgl.emitChange();
    await flushMicrotasks();
    expect(term.refresh).not.toHaveBeenCalled();
  });
});
