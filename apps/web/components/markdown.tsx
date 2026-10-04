import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders Markdown without raw HTML, so guide content can never inject markup or scripts. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-ulti">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          p: ({ children: c }) => <p className="my-3 leading-7">{c}</p>,
          ul: ({ children: c }) => <ul className="my-3 list-disc pl-6">{c}</ul>,
          ol: ({ children: c }) => <ol className="my-3 list-decimal pl-6">{c}</ol>,
          code: ({ children: c }) => <code className="rounded bg-surface px-1 py-0.5 text-[0.9em]">{c}</code>,
          pre: ({ children: c }) => <pre className="my-3 overflow-x-auto rounded-md border border-line bg-surface p-3 text-sm">{c}</pre>,
          blockquote: ({ children: c }) => <blockquote className="my-3 border-l-2 border-line pl-4 text-muted">{c}</blockquote>,
          table: ({ children: c }) => <table className="my-3 w-full border-collapse text-sm">{c}</table>,
          th: ({ children: c }) => <th className="border border-line px-2 py-1 text-left">{c}</th>,
          td: ({ children: c }) => <td className="border border-line px-2 py-1">{c}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
