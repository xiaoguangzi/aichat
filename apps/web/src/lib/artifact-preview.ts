import type { Artifact } from '@aichat/shared';
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildArtifactPreview(artifact: Pick<Artifact, 'kind' | 'code'>, origin: string): string {
  const runtime = `${origin}/artifact-runtime.js`;
  const csp = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${runtime}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:system-ui,sans-serif}*{box-sizing:border-box}#artifact-error{white-space:pre-wrap;color:#b91c1c;background:#fef2f2;padding:16px;font:13px monospace}svg{max-width:100%}</style>`;
  if (artifact.kind === 'html' || artifact.kind === 'svg') {
    // Security policy precedes every byte supplied by the model, even for full HTML documents.
    return `<!doctype html>${head}<script>addEventListener('error',e=>{const p=document.createElement('pre');p.textContent='预览出错：'+e.message;p.style.color='#b91c1c';document.body.append(p)})</script>${artifact.code}`;
  }
  const json = JSON.stringify(artifact).replace(/</g, '\\u003c');
  return `<!doctype html><html><head>${head}</head><body><div id="root"></div><pre id="artifact-error" hidden></pre><script id="artifact-source" type="application/json">${json}</script><script src="${escape(runtime)}" onerror="document.getElementById('artifact-error').hidden=false;document.getElementById('artifact-error').textContent='预览运行时加载失败，请重新构建并刷新。'"></script></body></html>`;
}
