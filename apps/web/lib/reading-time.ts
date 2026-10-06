/** Whole minutes to read some Markdown at an easy study pace (about 200 words a minute). At least 1. */
export function readingMinutes(markdown: string, wordsPerMinute = 200): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|~-]+/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / wordsPerMinute));
}
