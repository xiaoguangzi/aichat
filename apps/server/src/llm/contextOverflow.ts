/**
 * Providers report an over-long request as a generic 400/422 with prose in the message, and the
 * wording differs per vendor. Matching stays conservative (a message must actually talk about the
 * context/token limit) so an unrelated constraint error is never mistaken for one — a false
 * positive would silently drop history for a request that could have succeeded.
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  /context[_ ]length[_ ]exceeded/i,
  /context window/i,
  /maximum context length/i,
  /context length limit/i,
  /exceeds? the (?:maximum )?context/i,
  /too many (?:input )?tokens/i,
  /(?:input|prompt|request|message|conversation)[^.\n]{0,40}(?:is )?too long/i,
  /prompt is too long/i,
  /reduce the length of the (?:messages|input|prompt)/i,
  // Anthropic's Chinese gateway wording, and the general "token limit" phrasing.
  /上下文长度|上下文窗口|超出.{0,6}(?:上下文|token|令牌)/,
  /token limit/i,
  // OpenAI: "The input token count (129024) exceeds the maximum number of tokens allowed (128000)."
  /exceeds the maximum number of tokens/i,
];

export function isContextOverflowError(message: string): boolean {
  if (!message) return false;
  // A rejected max_tokens value arrives through the same 400 channel but is a request-parameter
  // problem, not an over-long history: the fix is different, so it must not squeeze history. Matched
  // narrowly ("max_tokens is too large") so a message that merely mentions the field alongside a
  // real context overflow still counts.
  if (/max_tokens[^\n]{0,30}(?:too large|exceeds|out of range|invalid)/i.test(message) && !/context/i.test(message)) return false;
  return CONTEXT_OVERFLOW_PATTERNS.some((re) => re.test(message));
}
