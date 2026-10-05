import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName: string };
}

/** Turns an inline <u>…</u> pair into an underline. It is the only HTML read, because Markdown has no underline and Obsidian renders this. */
function walk(node: MdNode) {
  if (!node.children) return;
  const kids = node.children;
  for (let i = 0; i < kids.length; i++) {
    if (kids[i]?.type !== "html" || kids[i]?.value?.trim().toLowerCase() !== "<u>") continue;
    const j = kids.findIndex((k, n) => n > i && k.type === "html" && k.value?.trim().toLowerCase() === "</u>");
    if (j === -1) continue;
    const inner = kids.slice(i + 1, j);
    kids.splice(i, j - i + 1, { type: "underline", data: { hName: "u" }, children: inner });
  }
  kids.forEach(walk);
}
const remarkUnderline = () => (tree: MdNode) => walk(tree);

/** Renders Markdown without raw HTML (apart from underline), so guide content can never inject markup or scripts. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-ulti">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkUnderline]}
        urlTransform={(url) => (/^(https?:|mailto:|#|\/)/i.test(url) ? url : "")}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} className="text-accent underline" rel="noopener noreferrer" target={href?.startsWith("http") ? "_blank" : undefined}>
              {c}
            </a>
          ),
          h1: ({ children: c }) => <h2 className="mt-8 text-2xl">{c}</h2>,
          h2: ({ children: c }) => <h3 className="mt-6 text-xl">{c}</h3>,
          h3: ({ children: c }) => <h4 className="mt-4 text-lg font-medium">{c}</h4>,
          u: ({ children: c }) => <u>{c}</u>,
          p: ({ children: c }) => <p className="my-3 leading-7">{c}</p>,
          ul: ({ children: c }) => <ul className="my-3 list-disc pl-6">{c}</ul>,
          ol: ({ children: c }) => <ol className="my-3 list-decimal pl-6">{c}</ol>,
          code: ({ children: c }) => <code className="rounded bg-surface px-1 py-0.5 text-[0.9em]">{c}</code>,
          pre: ({ children: c }) => <pre className="my-3 overflow-x-auto rounded-md border border-line bg-surface p-3 text-sm">{c}</pre>,
          blockquote: ({ children: c }) => <blockquote className="my-3 border-l-2 border-line pl-4 text-muted">{c}</blockquote>,
          table: ({ children: c }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-sm">{c}</table></div>,
          th: ({ children: c }) => <th scope="col" className="border border-line px-2 py-1 text-left">{c}</th>,
          td: ({ children: c }) => <td className="border border-line px-2 py-1">{c}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
