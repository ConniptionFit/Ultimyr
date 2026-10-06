import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../components/markdown-render";

describe("underline in notes", () => {
  it("renders <u> pairs and nothing else from raw HTML", () => {
    const html = renderToStaticMarkup(<Markdown>{"a <u>**b**</u> c <script>x</script> <b>d</b>"}</Markdown>);
    expect(html).toContain("<u><strong>b</strong></u>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
  });
});
