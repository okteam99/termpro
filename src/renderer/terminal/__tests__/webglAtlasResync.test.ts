import { describe, expect, it, vi } from 'vitest';
import { forceAtlasReupload, wireWebglAtlasResync } from '../webglAtlasResync';

/**
 * 最小假 WebglAddon:可手动 emit remove/change/add 事件,记录订阅 dispose。
 * change/add 故意暴露,用于断言 wire **不**订阅它们(只订阅 remove)。
 */
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
  it('删页(合并)事件后触发重建(onRearrange)', async () => {
    const webgl = makeFakeWebgl();
    const onRearrange = vi.fn();
    wireWebglAtlasResync(webgl, onRearrange);

    webgl.emitRemove();
    expect(onRearrange).not.toHaveBeenCalled(); // 微任务前不同步触发
    await flushMicrotasks();

    expect(onRearrange).toHaveBeenCalledTimes(1);
  });

  it('一帧内多次删页去抖为一次重建', async () => {
    const webgl = makeFakeWebgl();
    const onRearrange = vi.fn();
    wireWebglAtlasResync(webgl, onRearrange);

    webgl.emitRemove();
    webgl.emitRemove();
    webgl.emitRemove();
    await flushMicrotasks();

    expect(onRearrange).toHaveBeenCalledTimes(1);
  });

  it('去抖窗口结束后,新一轮删页再次触发重建', async () => {
    const webgl = makeFakeWebgl();
    const onRearrange = vi.fn();
    wireWebglAtlasResync(webgl, onRearrange);

    webgl.emitRemove();
    await flushMicrotasks();
    webgl.emitRemove();
    await flushMicrotasks();

    expect(onRearrange).toHaveBeenCalledTimes(2);
  });

  it('不订阅 change/add 事件(换实例自身走 setAtlas 自愈;且新 addon 初始化会发 change → 订阅会自激无限重建)', async () => {
    const webgl = makeFakeWebgl();
    const onRearrange = vi.fn();
    wireWebglAtlasResync(webgl, onRearrange);

    expect(webgl.changeCount).toBe(0);
    expect(webgl.addCount).toBe(0);
    expect(webgl.removeCount).toBe(1);

    // change/add 即便被 emit 也不触发重建
    webgl.emitChange();
    await flushMicrotasks();
    expect(onRearrange).not.toHaveBeenCalled();
  });

  it('stop() 解除订阅,后续删页不再重建', async () => {
    const webgl = makeFakeWebgl();
    const onRearrange = vi.fn();
    const stop = wireWebglAtlasResync(webgl, onRearrange);

    expect(webgl.removeCount).toBe(1);
    stop();
    expect(webgl.removeCount).toBe(0);

    webgl.emitRemove();
    await flushMicrotasks();
    expect(onRearrange).not.toHaveBeenCalled();
  });
});

describe('forceAtlasReupload', () => {
  it('结构完整:setAtlas(现图集) 被调用(全部纹理 version→-1 → 下一帧全量重传),返回 true', () => {
    const setAtlas = vi.fn();
    const charAtlas = { pages: [] };
    const webgl = {
      _renderer: { _glyphRenderer: { value: { setAtlas } }, _charAtlas: charAtlas },
    };

    expect(forceAtlasReupload(webgl)).toBe(true);
    expect(setAtlas).toHaveBeenCalledTimes(1);
    expect(setAtlas).toHaveBeenCalledWith(charAtlas);
  });

  it.each([
    ['无 _renderer', {}],
    ['无 _glyphRenderer.value', { _renderer: { _charAtlas: {} , _glyphRenderer: {} } }],
    ['无 _charAtlas', { _renderer: { _glyphRenderer: { value: { setAtlas() {} } } } }],
    ['setAtlas 非函数', { _renderer: { _glyphRenderer: { value: { setAtlas: 1 } }, _charAtlas: {} } }],
  ])('addon 内部结构变化(%s)→ 返回 false,调用方兜底整体重建', (_name, webgl) => {
    expect(forceAtlasReupload(webgl)).toBe(false);
  });

  it('setAtlas 抛错 → 返回 false(容错,不让渲染路径炸掉)', () => {
    const webgl = {
      _renderer: {
        _glyphRenderer: { value: { setAtlas: () => { throw new Error('gl dead'); } } },
        _charAtlas: {},
      },
    };
    expect(forceAtlasReupload(webgl)).toBe(false);
  });
});
