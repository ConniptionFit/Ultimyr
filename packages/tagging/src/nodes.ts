import nodesJson from "../data/nodes.json";

/** SVG shapes for every bundled icon, as Lucide icon nodes: [tag, attributes][]. Only the web app imports this. */
export type IconNode = Array<[string, Record<string, string>]>;
export const iconNodes = nodesJson as unknown as Record<string, IconNode>;
export const nodeFor = (name: string): IconNode | null => (Object.hasOwn(iconNodes, name) ? iconNodes[name]! : null);
