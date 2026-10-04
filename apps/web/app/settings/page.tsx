"use client";

import { terms, type TermKey } from "@ultimyr/lore";
import { AiPanel } from "@/components/ai-panel";
import { DisplayPanel } from "@/components/display-panel";
import { McpPanel } from "@/components/mcp-panel";
import { SecurityPanel } from "@/components/security-panel";
import { Pane } from "@/components/side-nav";
import { Toggle } from "@/components/ui";
import { RequireSession } from "@/lib/require-session";
import { useNaming } from "@/lib/naming";

const SECTIONS = [
  { id: "display", label: "Display" },
  { id: "security", label: "Security" },
  { id: "ai", label: "AI keys" },
  { id: "apps", label: "Connected apps" },
  { id: "names", label: "Themed names" },
];

/** Settings that only affect your own session. Instance-wide settings live in the admin panel. */
export default function Settings() {
  const { mode, setMode } = useNaming();
  return (
    <RequireSession wide>
      <Pane
        title="Your settings"
        intro="These only affect your own account and this device."
        nav={
          <nav aria-label="Settings sections" className="md:w-48 md:shrink-0">
            <ul className="flex flex-wrap gap-1 md:sticky md:top-6 md:flex-col">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-md px-3 py-1.5 text-sm text-muted hover:text-ink">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        }
      >
        <div id="display" className="scroll-mt-6 [&>section]:border-t-0 [&>section]:pt-0">
          <DisplayPanel />
        </div>
        <div id="security" className="scroll-mt-6 space-y-8 border-t border-line pt-8">
          <h2 className="text-xl">Security</h2>
          <SecurityPanel />
        </div>
        <div id="ai" className="scroll-mt-6 [&>section]:pt-0">
          <AiPanel />
        </div>
        <div id="apps" className="scroll-mt-6 [&>section]:pt-0">
          <McpPanel />
        </div>
        <section id="names" className="scroll-mt-6 space-y-4 border-t border-line pt-8">
          <div>
            <h2 className="text-xl">Themed names</h2>
            <p className="text-sm text-muted">Show Ultimyr&apos;s Archive-inspired names, or keep plain labels. Only the labels change. Off by default.</p>
          </div>
          <Toggle label="Themed names" on={mode === "themed"} onChange={(on) => setMode(on ? "themed" : "plain")} />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">See all names</summary>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-line p-4">
              {(Object.keys(terms) as TermKey[]).map((k) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{terms[k].plain}</dt>
                  <dd>{terms[k].themed}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      </Pane>
    </RequireSession>
  );
}
