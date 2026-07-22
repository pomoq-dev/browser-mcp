import type { BoundingBox, ElementTarget } from "@browser-mcp/shared";

export function isElementVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  // partially in viewport is ok for SOM
  if (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight ||
    rect.left > window.innerWidth
  ) {
    return false;
  }
  return true;
}

export function getBBox(el: Element): BoundingBox {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}

export function getXPath(el: Element): string {
  if (el.id) return `//*[@id=${JSON.stringify(el.id)}]`;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.nodeName === current.nodeName) index++;
      sibling = sibling.previousElementSibling;
    }
    const tag = current.nodeName.toLowerCase();
    parts.unshift(`${tag}[${index}]`);
    current = current.parentElement;
    if (parts.length > 20) break;
  }
  return "/" + parts.join("/");
}

export function getUniqueSelector(el: Element): string {
  if (el.id) {
    const idSel = `#${CSS.escape(el.id)}`;
    try {
      if (document.querySelectorAll(idSel).length === 1) return idSel;
    } catch {
      /* ignore */
    }
  }

  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${CSS.escape(current.id)}`;
      parts.unshift(part);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    // prefer data-testid / name / aria
    const testId =
      current.getAttribute("data-testid") ||
      current.getAttribute("data-test-id");
    if (testId) {
      part = `${current.tagName.toLowerCase()}[data-testid=${JSON.stringify(testId)}]`;
      parts.unshift(part);
      break;
    }
    const name = current.getAttribute("name");
    if (name && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(current.tagName)) {
      part = `${current.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`;
      parts.unshift(part);
      const full = parts.join(" > ");
      try {
        if (document.querySelectorAll(full).length === 1) return full;
      } catch {
        /* continue */
      }
    }
    parts.unshift(part);
    current = parent;
    if (parts.length > 8) break;
  }
  return parts.join(" > ");
}

export function getElementText(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim().slice(0, 120);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return (
      el.placeholder ||
      el.value ||
      el.getAttribute("name") ||
      el.type ||
      ""
    ).slice(0, 120);
  }
  if (el instanceof HTMLElement) {
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return t.slice(0, 120);
  }
  return "";
}

export function resolveTarget(
  target: ElementTarget,
  somMap?: Map<number, Element>,
): { element?: Element; x?: number; y?: number } {
  if ("som_id" in target) {
    const el = somMap?.get(target.som_id);
    if (!el) throw new Error(`SOM id ${target.som_id} not found. Call browser_get_visual_state first.`);
    const box = getBBox(el);
    return {
      element: el,
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
    };
  }
  if ("selector" in target) {
    const el = document.querySelector(target.selector);
    if (!el) throw new Error(`Selector not found: ${target.selector}`);
    const box = getBBox(el);
    return {
      element: el,
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
    };
  }
  if ("xpath" in target) {
    const result = document.evaluate(
      target.xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    const el = result.singleNodeValue as Element | null;
    if (!el) throw new Error(`XPath not found: ${target.xpath}`);
    const box = getBBox(el);
    return {
      element: el,
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
    };
  }
  if ("coordinates" in target) {
    return {
      x: target.coordinates.x,
      y: target.coordinates.y,
      element: document.elementFromPoint(
        target.coordinates.x,
        target.coordinates.y,
      ) ?? undefined,
    };
  }
  throw new Error("Invalid target");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
