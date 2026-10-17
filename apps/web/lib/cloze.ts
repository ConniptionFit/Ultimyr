/** Cloze deletion: write `{{c1::answer}}` or `{{c1::answer::hint}}` in a card's front and the answer is hidden until you reveal it. */
const CLOZE = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export const isCloze = (front: string) => {
  CLOZE.lastIndex = 0;
  return CLOZE.test(front);
};

/** What to show before and after the reveal. A card without cloze markup is returned unchanged. `plain` leaves out the bold markup for places that do not render Markdown. */
export function clozeSides(front: string, back: string, plain = false): { front: string; back: string } {
  if (!isCloze(front)) return { front, back };
  const hidden = front.replace(CLOZE, (_m, _answer: string, hint?: string) => (plain ? `[${hint?.trim() || "..."}]` : `**[${hint?.trim() || "..."}]**`));
  const shown = front.replace(CLOZE, (_m, answer: string) => (plain ? answer : `**${answer}**`));
  return { front: hidden, back: back.trim() ? `${shown}\n\n${back}` : shown };
}
