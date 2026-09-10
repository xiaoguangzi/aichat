/** Only the official Chat Completions endpoint gets DeepSeek-specific behavior.
 * A custom gateway selecting the DeepSeek dialect retains its existing semantics. */
export function isOfficialDeepSeek(provider: { type: string; baseUrl: string }): boolean {
  if (provider.type !== 'openai') return false;
  try {
    const url = new URL(provider.baseUrl);
    return url.origin === 'https://api.deepseek.com'
      && !url.username && !url.password && !url.search && !url.hash
      && ['', '/v1', '/beta'].includes(url.pathname.replace(/\/+$/, ''));
  } catch {
    return false;
  }
}
