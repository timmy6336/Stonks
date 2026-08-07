/**
 * Parses a JSON object out of a raw LLM response, tolerating markdown fences and — via a
 * regex-based recovery pass — a response that got cut off mid-object (hit the provider's output
 * token limit) or came back structurally malformed (e.g. items wrapped in stray sibling arrays)
 * before it finished valid JSON.
 *
 * When the straightforward parse fails, recovery pulls the summary text and every *complete* item
 * object out via regex: an item object is flat (no nested braces), so a balanced `{...}` match
 * reliably captures only whole ones regardless of whatever invalid punctuation surrounds them, and
 * naturally skips a trailing partial one. `arrayKey` names the field the recovered items are
 * returned under (e.g. "actions" or "picks"); `isItem` distinguishes a recovered blob that
 * actually belongs in that array from an unrelated fragment.
 */
export function parseJsonWithRecovery(
  raw: string,
  arrayKey: string,
  isItem: (obj: Record<string, unknown>) => boolean
): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('Response did not contain a JSON object.');
  }

  const end = text.lastIndexOf('}');
  if (end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through — the slice from first '{' to last '}' wasn't valid JSON (truncated, or malformed)
    }
  }

  return recoverMalformed(text.slice(start), arrayKey, isItem);
}

function recoverMalformed(
  text: string,
  arrayKey: string,
  isItem: (obj: Record<string, unknown>) => boolean
): Record<string, unknown> {
  const summaryMatch = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const itemMatches = text.match(/\{[^{}]*\}/g) ?? [];
  const items: unknown[] = [];
  for (const m of itemMatches) {
    try {
      const obj = JSON.parse(m);
      if (obj && typeof obj === 'object' && isItem(obj)) items.push(obj);
    } catch {
      // this object itself didn't parse either — skip it, not worth guessing at
    }
  }
  if (!summaryMatch && items.length === 0) {
    throw new Error('Response did not contain a usable JSON object.');
  }
  const recoveryNote = ' [recovered from a malformed response — some items may be missing]';
  return {
    summary: (summaryMatch ? summaryMatch[1] : 'No summary provided.') + recoveryNote,
    [arrayKey]: items,
  };
}
