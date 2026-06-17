import { describe, expect, it, vi } from 'vitest';
import { wireWebglAtlasResync } from '../webglAtlasResync';

/** 最小假 WebglAddon:可手动 emit remove/change 事件,记录订阅 dispose,桩 clearTextureAtlas。 */
function makeFakeWebgl() {
  const removeListeners = new Set<() => void>();
  const changeListeners = new Set<() => void>();
  const addListeners = new Set<() => void>();
  return {
    clearTextureAtlas: vi.fn(),
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
  it('删页(合并)事件后清空图集(clearTextureAtlas)', async () => {
    const webgl = makeFakeWebgl();
    wireWebglAtlasResync(webgl);

    webgl.emitRemove();
    expect(webgl.clearTextureAtlas).not.toHaveBeenCalled(); // 微任务前不同步触发
    await flushMicrotasks();

    expect(webgl.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it('换图集事件也触发清空图集', async () => {
    const webgl = makeFakeWebgl();
    wireWebglAtlasResync(webgl);

    webgl.emitChange();
    await flushMicrotasks();

    expect(webgl.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it('一帧内多次图集变更去抖为一次清空', async () => {
    const webgl = makeFakeWebgl();
    wireWebglAtlasResync(webgl);

    webgl.emitRemove();
    webgl.emitRemove();
    webgl.emitChange();
    await flushMicrotasks();

    expect(webgl.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it('去抖窗口结束后,新一轮变更再次触发清空', async () => {
    const webgl = makeFakeWebgl();
    wireWebglAtlasResync(webgl);

    webgl.emitRemove();
    await flushMicrotasks();
    webgl.emitRemove();
    await flushMicrotasks();

    expect(webgl.clearTextureAtlas).toHaveBeenCalledTimes(2);
  });

  it('不订阅 onAddTextureAtlasCanvas(增页不重排索引 · 锁定设计意图)', async () => {
    const webgl = makeFakeWebgl();
    wireWebglAtlasResync(webgl);

    expect(webgl.addCount).toBe(0);
  });

  it('stop() 解除订阅,后续事件不再清空', async () => {
    const webgl = makeFakeWebgl();
    const stop = wireWebglAtlasResync(webgl);

    expect(webgl.removeCount).toBe(1);
    expect(webgl.changeCount).toBe(1);

    stop();
    expect(webgl.removeCount).toBe(0);
    expect(webgl.changeCount).toBe(0);

    webgl.emitRemove();
    webgl.emitChange();
    await flushMicrotasks();
    expect(webgl.clearTextureAtlas).not.toHaveBeenCalled();
  });
});
