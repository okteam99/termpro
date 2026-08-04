// Monaco 懒加载入口:只在打开查看器/diff 时 import 本模块,
// 首屏 bundle 不含 Monaco(README 工程红线③)。
// 仅注册 editor.worker:语法高亮走 monarch 不需要语言 worker。

import * as monaco from 'monaco-editor';
// eslint-disable-next-line import/no-unresolved
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme('okwork-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1b1b1b',
    'editor.foreground': '#e8e6e3',
    'editorLineNumber.foreground': '#6e6c66',
    'diffEditor.insertedTextBackground': '#98c37922',
    'diffEditor.removedTextBackground': '#e06c7522',
  },
});

export default monaco;
export type Monaco = typeof monaco;
