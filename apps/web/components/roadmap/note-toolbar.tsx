"use client";

import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import * as fmt from "@/lib/note-format";

type Run = (text: string, start: number, end: number) => fmt.Edit;
interface Tool {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the tooltip, and handled in the text box. */
  keys?: string;
  run?: Run;
  /** Browser history, so Undo and Redo also reach edits made with these buttons. */
  history?: "undo" | "redo";
}

const GROUPS: Tool[][] = [
  [
    { id: "undo", label: "Undo", icon: Undo2, history: "undo", keys: "Ctrl+Z" },
    { id: "redo", label: "Redo", icon: Redo2, history: "redo", keys: "Ctrl+Shift+Z" },
  ],
  [
    { id: "h1", label: "Heading 1", icon: Heading1, run: (t, s, e) => fmt.setHeading(t, s, e, 1) },
    { id: "h2", label: "Heading 2", icon: Heading2, run: (t, s, e) => fmt.setHeading(t, s, e, 2) },
    { id: "h3", label: "Heading 3", icon: Heading3, run: (t, s, e) => fmt.setHeading(t, s, e, 3) },
  ],
  [
    { id: "bold", label: "Bold", icon: Bold, keys: "Ctrl+B", run: (t, s, e) => fmt.toggleInline(t, s, e, "bold") },
    { id: "italic", label: "Italic", icon: Italic, keys: "Ctrl+I", run: (t, s, e) => fmt.toggleInline(t, s, e, "italic") },
    { id: "underline", label: "Underline", icon: Underline, keys: "Ctrl+U", run: (t, s, e) => fmt.toggleInline(t, s, e, "underline") },
    { id: "strike", label: "Strikethrough", icon: Strikethrough, keys: "Ctrl+Shift+X", run: (t, s, e) => fmt.toggleInline(t, s, e, "strike") },
    { id: "code", label: "Inline code", icon: Code, keys: "Ctrl+E", run: (t, s, e) => fmt.toggleInline(t, s, e, "code") },
    { id: "clear", label: "Clear formatting", icon: RemoveFormatting, run: fmt.clearFormatting },
  ],
  [
    { id: "bullet", label: "Bulleted list", icon: List, run: (t, s, e) => fmt.toggleList(t, s, e, "bullet") },
    { id: "number", label: "Numbered list", icon: ListOrdered, run: (t, s, e) => fmt.toggleList(t, s, e, "number") },
    { id: "task", label: "Checklist", icon: ListChecks, run: (t, s, e) => fmt.toggleList(t, s, e, "task") },
    { id: "outdent", label: "Decrease indent", icon: IndentDecrease, run: fmt.outdent },
    { id: "indent", label: "Increase indent", icon: IndentIncrease, run: fmt.indent },
  ],
  [
    { id: "quote", label: "Quote", icon: Quote, run: fmt.toggleQuote },
    { id: "codeblock", label: "Code block", icon: SquareCode, run: fmt.toggleCodeBlock },
    { id: "link", label: "Link", icon: LinkIcon, keys: "Ctrl+K", run: fmt.insertLink },
    { id: "table", label: "Table", icon: Table, run: fmt.insertTable },
    { id: "rule", label: "Divider line", icon: Minus, run: fmt.insertRule },
  ],
];
const ALL = GROUPS.flat();
const BY_KEY: Record<string, string> = { b: "bold", i: "italic", u: "underline", k: "link", e: "code" };

/** Replaces only the part of the text that changed, through the browser's own editing, so Undo and Redo keep working. */
export function applyEdit(el: HTMLTextAreaElement, edit: fmt.Edit, setText: (t: string) => void) {
  const old = el.value;
  let head = 0;
  while (head < old.length && head < edit.text.length && old[head] === edit.text[head]) head++;
  let tail = 0;
  while (tail < old.length - head && tail < edit.text.length - head && old[old.length - 1 - tail] === edit.text[edit.text.length - 1 - tail]) tail++;
  const insert = edit.text.slice(head, edit.text.length - tail);
  el.focus();
  el.setSelectionRange(head, old.length - tail);
  const ok = document.execCommand?.(insert ? "insertText" : "delete", false, insert) ?? false;
  if (!ok || el.value !== edit.text) {
    el.value = edit.text;
    setText(edit.text);
  }
  el.setSelectionRange(edit.start, edit.end);
}

/** Runs a keyboard shortcut or list-continuing Enter in the note box. Returns true when it handled the key. */
export function noteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, setText: (t: string) => void): boolean {
  const el = e.currentTarget;
  if (e.nativeEvent.isComposing) return false;
  const mod = e.ctrlKey || e.metaKey;
  let run: Run | undefined;
  if (mod && !e.altKey && !e.shiftKey && BY_KEY[e.key.toLowerCase()]) run = ALL.find((t) => t.id === BY_KEY[e.key.toLowerCase()])?.run;
  else if (mod && e.shiftKey && e.key.toLowerCase() === "x") run = ALL.find((t) => t.id === "strike")?.run;
  if (run) {
    e.preventDefault();
    applyEdit(el, run(el.value, el.selectionStart, el.selectionEnd), setText);
    return true;
  }
  if (e.key === "Enter" && !mod && !e.shiftKey && !e.altKey && el.selectionStart === el.selectionEnd) {
    const next = fmt.continueList(el.value, el.selectionStart);
    if (next) {
      e.preventDefault();
      applyEdit(el, next, setText);
      return true;
    }
  }
  return false;
}

/** Formatting buttons for the note box. They write plain Markdown, so the note reads the same in Obsidian. */
export function NoteToolbar({ target, controls, setText }: { target: RefObject<HTMLTextAreaElement | null>; controls: string; setText: (t: string) => void }) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function press(tool: Tool) {
    const el = target.current;
    if (!el) return;
    if (tool.history) {
      el.focus();
      document.execCommand?.(tool.history);
    } else if (tool.run) applyEdit(el, tool.run(el.value, el.selectionStart, el.selectionEnd), setText);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const to = e.key === "ArrowRight" ? (active + 1) % ALL.length : e.key === "ArrowLeft" ? (active - 1 + ALL.length) % ALL.length : e.key === "Home" ? 0 : e.key === "End" ? ALL.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    setActive(to);
    buttons.current[to]?.focus();
  }

  let n = -1;
  return (
    <div role="toolbar" aria-label="Text formatting" aria-controls={controls} onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-md border border-line bg-surface p-1">
      {GROUPS.map((group, g) => (
        <div key={g} role="group" className={`flex items-center gap-0.5 ${g > 0 ? "border-l border-line pl-1" : ""}`}>
          {group.map((tool) => {
            const i = ++n;
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                ref={(b) => {
                  buttons.current[i] = b;
                }}
                type="button"
                title={tool.keys ? `${tool.label} (${tool.keys})` : tool.label}
                aria-label={tool.label}
                tabIndex={i === active ? 0 : -1}
                onFocus={() => setActive(i)}
                // Keep the selection in the note box while pressing a button.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => press(tool)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-bg hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Icon size={16} aria-hidden />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
