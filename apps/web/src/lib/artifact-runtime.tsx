// Executed only inside the opaque-origin artifact iframe, never in the application window.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Icons from 'lucide-react';
import * as Charts from 'recharts';
import mermaid from 'mermaid';
import { transform } from 'sucrase';

const showError = (error: unknown) => {
  const el = document.getElementById('artifact-error')!;
  el.hidden = false;
  el.textContent = `预览出错：${error instanceof Error ? error.message : String(error)}`;
};
window.addEventListener('error', e => showError(e.error ?? e.message));
window.addEventListener('unhandledrejection', e => showError(e.reason));
class Boundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error) { showError(error); }
  render() { return this.state.error ? null : this.props.children; }
}
async function run() {
  const data = JSON.parse(document.getElementById('artifact-source')!.textContent!) as { kind: string; code: string };
  if (data.kind === 'mermaid') {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const { svg } = await mermaid.render('artifact-diagram', data.code);
    document.getElementById('root')!.innerHTML = svg;
  } else {
    const modules: Record<string, unknown> = { react: React, 'react-dom/client': ReactDOM, 'lucide-react': Icons, recharts: Charts };
    const require = (name: string) => {
      if (!(name in modules)) throw new Error(`不支持依赖 ${name}。可用：${Object.keys(modules).join(', ')}`);
      return modules[name];
    };
    const compiled = transform(data.code, { transforms: ['typescript', 'jsx', 'imports'], production: true, jsxRuntime: 'classic' }).code;
    const exports: { default?: React.ComponentType } = {};
    new Function('require', 'exports', 'React', compiled)(require, exports, React);
    if (!exports.default) throw new Error('React 作品需要 export default 一个组件');
    ReactDOM.createRoot(document.getElementById('root')!).render(<Boundary>{React.createElement(exports.default)}</Boundary>);
  }
}
void run().catch(showError);
