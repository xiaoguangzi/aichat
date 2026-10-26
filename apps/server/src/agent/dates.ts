import type { Block, Message } from '@aichat/shared';

/**
 * What the model is told about "today". The server runs on the user's machine, so its local zone is
 * the user's zone; UTC would put a user east of Greenwich on yesterday for part of every morning.
 *
 * Every date here is derived from stored timestamps, never from the clock at request time, so a
 * replayed request is byte-identical to the one before it and the provider's prompt cache survives
 * midnight. The system prompt carries the date the conversation started; a later user message that
 * lands on a different day carries a short note with the new date instead.
 */
export function localDate(at: string | Date, timeZone?: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(d);
  return `${ymd} (${weekday})`;
}

/** A message the user wrote, as opposed to a tool result the loop sent back on their behalf. */
const isUserTurn = (m: Pick<Message, 'role' | 'content'>) => m.role === 'user' && m.content.some(b => b.type !== 'tool_result');

/** Date the conversation (this branch of it) started; today when nothing has been sent yet. */
export function conversationDate(messages: Pick<Message, 'role' | 'content' | 'createdAt'>[], timeZone?: string): string {
  const first = messages.find(isUserTurn);
  return localDate(first?.createdAt ?? new Date(), timeZone);
}

const dateNote = (date: string): Block => ({ type: 'text', text: `[Date update from the app, not written by the user: today is now ${date}.]` });

/**
 * Prepend a date note to each user message sent on a different day than the last one the model was
 * told about. Returns new message objects; stored messages are never modified.
 */
export function withDateNotes<T extends Pick<Message, 'role' | 'content' | 'createdAt'>>(messages: T[], startDate: string, timeZone?: string): T[] {
  let announced = startDate;
  return messages.map(m => {
    if (!isUserTurn(m)) return m;
    const date = localDate(m.createdAt, timeZone);
    if (date === announced) return m;
    announced = date;
    return { ...m, content: [dateNote(date), ...m.content] };
  });
}
