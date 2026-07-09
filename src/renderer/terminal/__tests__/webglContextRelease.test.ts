import { describe, expect, it, vi } from 'vitest';
import { disposeWebglAddon } from '../webglContextRelease';

/**
 * 最小假 WebglAddon:结构化匹配私有链 _renderer._canvas,canvas 提供可注入行为的
 * getContext/getExtension/loseContext,用于断言「dispose 后确定性释放 context」。
 */
function makeFakeWebgl(overrides?: {
  getContext?: () => unknown;
  getExtension?: (name: string) => unknown;
  noRenderer?: boolean;
}) {
  const loseContext = vi.fn();
  const getExtension = vi.fn(
    overrides?.getExtension ??
      ((name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null)),
  );
  const getContext = vi.fn(overrides?.getContext ?? (() => ({ getExtension })));
  const canvas = { getContext } as unknown as HTMLCanvasElement;
  const dispose = vi.fn();
  const webgl = overrides?.noRenderer
    ? { dispose }
    : { dispose, _renderer: { _canvas: canvas } };
  return { webgl, dispose, getContext, getExtension, loseContext };
}

describe('disposeWebglAddon', () => {
  it('dispose 后立即 loseContext,且顺序为先 dispose 再释放(避免 GL 清理调用变 INVALID_OPERATION)', () => {
    const { webgl, dispose, getContext, loseContext } = makeFakeWebgl();

    disposeWebglAddon(webgl);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledTimes(1);
    expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(
      loseContext.mock.invocationCallOrder[0],
    );
  });

  it('addon 内部结构变化(无 _renderer)→ 仍正常 dispose,不抛错', () => {
    const { webgl, dispose } = makeFakeWebgl({ noRenderer: true });

    expect(() => disposeWebglAddon(webgl)).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('getContext 返回 null(context 不可得)→ 静默跳过释放', () => {
    const { webgl, dispose } = makeFakeWebgl({ getContext: () => null });

    expect(() => disposeWebglAddon(webgl)).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('getExtension 抛错(context 已丢失等边缘情况)→ 被吞掉,dispose 已生效', () => {
    const { webgl, dispose } = makeFakeWebgl({
      getExtension: () => {
        throw new Error('context lost');
      },
    });

    expect(() => disposeWebglAddon(webgl)).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
