import type { SomElement } from "@browser-mcp/shared";
import {
  getBBox,
  getElementText,
  getUniqueSelector,
  getXPath,
  isElementVisible,
} from "./dom-utils.js";

const OVERLAY_ID = "__browser_mcp_som_overlay__";
const DEFAULT_TYPES = [
  "button",
  "input",
  "a",
  "select",
  "textarea",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=checkbox]",
  "[role=menuitem]",
  "[role=option]",
  "[role=switch]",
  "[contenteditable=true]",
  "summary",
  "label",
];

/** Module-level SOM map for subsequent click-by-id */
let lastSomMap = new Map<number, Element>();

export function getSomMap(): Map<number, Element> {
  return lastSomMap;
}

export function clearSomMap(): void {
  lastSomMap = new Map();
}

function collectInteractive(elementTypes: string[]): Element[] {
  const selector = elementTypes.join(",");
  const nodes = Array.from(document.querySelectorAll(selector));

  // Also catch clickable elements with onclick / tabindex
  const extra = Array.from(
    document.querySelectorAll(
      "[onclick], [tabindex]:not([tabindex='-1']), summary, [data-testid]",
    ),
  );

  const all = new Set<Element>([...nodes, ...extra]);
  const visible: Element[] = [];

  for (const el of all) {
    if (!isElementVisible(el)) continue;
    // skip our own overlay
    if (el.closest(`#${OVERLAY_ID}`)) continue;
    // skip hidden inputs
    if (el instanceof HTMLInputElement && el.type === "hidden") continue;
    visible.push(el);
  }

  // Sort top-to-bottom, left-to-right
  visible.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (Math.abs(ra.top - rb.top) > 8) return ra.top - rb.top;
    return ra.left - rb.left;
  });

  return visible;
}

export function applySomLabels(elementTypes: string[] = DEFAULT_TYPES): {
  elements: SomElement[];
  map: Map<number, Element>;
} {
  removeSomOverlay();
  const els = collectInteractive(elementTypes);
  const map = new Map<number, Element>();
  const elements: SomElement[] = [];

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483646",
  });

  let id = 1;
  for (const el of els) {
    const bbox = getBBox(el);
    const somEl: SomElement = {
      id,
      tag: el.tagName,
      role: el.getAttribute("role") ?? undefined,
      type: el instanceof HTMLInputElement ? el.type : undefined,
      text: getElementText(el),
      name: el.getAttribute("name") ?? undefined,
      href: el instanceof HTMLAnchorElement ? el.href : undefined,
      value:
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.value?.slice(0, 80)
          : undefined,
      placeholder:
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.placeholder
          : undefined,
      ariaLabel: el.getAttribute("aria-label") ?? undefined,
      bbox,
      selector: getUniqueSelector(el),
      xpath: getXPath(el),
      visible: true,
      enabled: !(el as HTMLButtonElement).disabled,
    };
    elements.push(somEl);
    map.set(id, el);

    const badge = document.createElement("div");
    badge.textContent = String(id);
    Object.assign(badge.style, {
      position: "fixed",
      left: `${Math.max(0, bbox.x)}px`,
      top: `${Math.max(0, bbox.y)}px`,
      background: "#7c3aed",
      color: "#fff",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "11px",
      fontWeight: "700",
      lineHeight: "1",
      padding: "2px 4px",
      borderRadius: "3px",
      border: "1px solid #fff",
      boxShadow: "0 1px 3px rgba(0,0,0,.45)",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    overlay.appendChild(badge);

    // light outline
    const outline = document.createElement("div");
    Object.assign(outline.style, {
      position: "fixed",
      left: `${bbox.x}px`,
      top: `${bbox.y}px`,
      width: `${bbox.w}px`,
      height: `${bbox.h}px`,
      border: "1px solid rgba(124,58,237,.55)",
      borderRadius: "2px",
      boxSizing: "border-box",
      pointerEvents: "none",
    });
    overlay.appendChild(outline);

    id++;
  }

  document.documentElement.appendChild(overlay);
  lastSomMap = map;
  return { elements, map };
}

export function removeSomOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

export function buildDomTree(
  root: Element = document.body,
  maxDepth = 12,
  includeInvisible = false,
  depth = 0,
): unknown {
  if (!root || depth > maxDepth) return null;
  if (!includeInvisible && root instanceof Element && !isElementVisible(root)) {
    // still walk children of body/html
    if (root !== document.body && root !== document.documentElement) {
      // allow containers that may have visible kids even if zero opacity ancestors... skip
    }
  }

  const tag = root.tagName?.toLowerCase();
  if (!tag || tag === "script" || tag === "style" || tag === "noscript" || tag === "svg") {
    if (tag === "svg") {
      return {
        tag: "svg",
        selector: getUniqueSelector(root),
        xpath: getXPath(root),
        children: [],
      };
    }
    return null;
  }

  const text = getElementText(root);
  const node: Record<string, unknown> = {
    tag,
    selector: getUniqueSelector(root),
    xpath: getXPath(root),
    children: [] as unknown[],
  };
  if (root.id) node.id = root.id;
  if (root.classList?.length) {
    node.classes = Array.from(root.classList).slice(0, 8);
  }
  if (text && root.children.length === 0) node.text = text.slice(0, 100);
  if (isElementVisible(root)) node.bbox = getBBox(root);

  const attrs: Record<string, string> = {};
  for (const name of ["href", "name", "type", "role", "aria-label", "placeholder", "data-testid"]) {
    const v = root.getAttribute(name);
    if (v) attrs[name] = v.slice(0, 100);
  }
  if (Object.keys(attrs).length) node.attrs = attrs;

  const kids: unknown[] = [];
  for (const child of Array.from(root.children).slice(0, 80)) {
    const built = buildDomTree(child, maxDepth, includeInvisible, depth + 1);
    if (built) kids.push(built);
  }
  node.children = kids;
  return node;
}
