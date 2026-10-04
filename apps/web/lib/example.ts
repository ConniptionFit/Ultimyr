/** Creates the bundled example archive (guides, decks and a quiz) for the signed in person. They own it and can delete it. */
export async function loadExample(api: <T>(method: string, path: string, body?: unknown) => Promise<T>): Promise<string> {
  const res = await fetch("/examples/comptia-aplus.json");
  if (!res.ok) throw new Error("example_missing");
  const doc = (await res.json()) as { format: string; version: number; archive: unknown; items: unknown[]; quiz: { title: string; summary: string; questions: unknown[] } };
  const { archiveId } = await api<{ archiveId: string }>("POST", "import", { format: "archive-json", content: { format: doc.format, version: doc.version, archive: doc.archive, items: doc.items } });
  const quiz = await api<{ id: string }>("POST", `archives/${archiveId}/items`, { kind: "quiz", title: doc.quiz.title, summary: doc.quiz.summary });
  await api("POST", `quizzes/${quiz.id}/questions/bulk`, { questions: doc.quiz.questions });
  return archiveId;
}
