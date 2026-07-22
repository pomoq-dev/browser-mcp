import type { ElementTarget } from "@browser-mcp/shared";
import {
  getBBox,
  randomBetween,
  resolveTarget,
  sleep,
} from "./dom-utils.js";
import { getSomMap } from "./som.js";

function dispatchMouse(
  type: string,
  x: number,
  y: number,
  options: MouseEventInit = {},
): void {
  const target = document.elementFromPoint(x, y) ?? document.body;
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: options.button ?? 0,
    buttons: options.buttons ?? 1,
    ctrlKey: options.ctrlKey,
    shiftKey: options.shiftKey,
    altKey: options.altKey,
    metaKey: options.metaKey,
    detail: options.detail ?? 1,
    ...options,
  });
  target.dispatchEvent(event);
}

/** Cubic Bezier path from A to B */
function bezierPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  steps = 18,
): Array<{ x: number; y: number }> {
  const cx1 = x0 + (x1 - x0) * randomBetween(0.2, 0.4) + randomBetween(-40, 40);
  const cy1 = y0 + (y1 - y0) * randomBetween(0.1, 0.3) + randomBetween(-40, 40);
  const cx2 = x0 + (x1 - x0) * randomBetween(0.6, 0.8) + randomBetween(-40, 40);
  const cy2 = y0 + (y1 - y0) * randomBetween(0.7, 0.9) + randomBetween(-40, 40);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x =
      u * u * u * x0 +
      3 * u * u * t * cx1 +
      3 * u * t * t * cx2 +
      t * t * t * x1;
    const y =
      u * u * u * y0 +
      3 * u * u * t * cy1 +
      3 * u * t * t * cy2 +
      t * t * t * y1;
    points.push({ x, y });
  }
  return points;
}

let lastMouse = { x: 10, y: 10 };

async function moveMouseTo(x: number, y: number): Promise<void> {
  const path = bezierPath(lastMouse.x, lastMouse.y, x, y);
  for (const p of path) {
    dispatchMouse("mousemove", p.x, p.y, { buttons: 0 });
    lastMouse = p;
    await sleep(randomBetween(4, 14));
  }
}

function modifiersToFlags(modifiers: string[] = []) {
  return {
    ctrlKey: modifiers.includes("Control"),
    shiftKey: modifiers.includes("Shift"),
    altKey: modifiers.includes("Alt"),
    metaKey: modifiers.includes("Meta"),
  };
}

export async function humanClick(
  target: ElementTarget,
  clickType: "left" | "right" | "double" | "middle" = "left",
  modifiers: string[] = [],
): Promise<{ ok: true; x: number; y: number }> {
  const resolved = resolveTarget(target, getSomMap());
  const x = resolved.x!;
  const y = resolved.y!;

  if (resolved.element instanceof HTMLElement) {
    resolved.element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
    await sleep(80);
  }

  // re-resolve after scroll
  const again = resolveTarget(target, getSomMap());
  const cx = again.x! + randomBetween(-2, 2);
  const cy = again.y! + randomBetween(-2, 2);

  await moveMouseTo(cx, cy);
  const flags = modifiersToFlags(modifiers);
  const button =
    clickType === "right" ? 2 : clickType === "middle" ? 1 : 0;

  dispatchMouse("mousedown", cx, cy, { button, buttons: 1 << button, ...flags });
  await sleep(randomBetween(30, 90));
  dispatchMouse("mouseup", cx, cy, { button, buttons: 0, ...flags });

  if (clickType === "double") {
    dispatchMouse("click", cx, cy, { button, detail: 1, ...flags });
    await sleep(randomBetween(40, 100));
    dispatchMouse("mousedown", cx, cy, { button, buttons: 1, ...flags });
    await sleep(randomBetween(20, 50));
    dispatchMouse("mouseup", cx, cy, { button, buttons: 0, ...flags });
    dispatchMouse("click", cx, cy, { button, detail: 2, ...flags });
    dispatchMouse("dblclick", cx, cy, { button, detail: 2, ...flags });
  } else if (clickType === "right") {
    dispatchMouse("contextmenu", cx, cy, { button: 2, ...flags });
  } else {
    dispatchMouse("click", cx, cy, { button, detail: 1, ...flags });
    // also call .click() for reliability on React
    if (again.element instanceof HTMLElement && clickType === "left") {
      again.element.focus?.();
      again.element.click();
    }
  }

  return { ok: true, x: cx, y: cy };
}

export async function humanType(
  target: ElementTarget,
  text: string,
  options: {
    clearFirst?: boolean;
    pressEnter?: boolean;
    delayMs?: number;
  } = {},
): Promise<{ ok: true; length: number }> {
  const { clearFirst = true, pressEnter = false, delayMs = 30 } = options;
  const resolved = resolveTarget(target, getSomMap());
  const el = resolved.element;
  if (!el) throw new Error("No element for type target");

  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    el.focus();
    await sleep(40);
  }

  if (clearFirst) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.select();
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if ((el as HTMLElement).isContentEditable) {
      (el as HTMLElement).textContent = "";
    }
  }

  for (const char of text) {
    const keyOpts = {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
    el.dispatchEvent(new KeyboardEvent("keypress", keyOpts));

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc?.set?.call(el, el.value + char);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if ((el as HTMLElement).isContentEditable) {
      (el as HTMLElement).textContent =
        ((el as HTMLElement).textContent || "") + char;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char }));
    }

    el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
    await sleep(delayMs + randomBetween(-10, 25));
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));

  if (pressEnter) {
    await humanPressKey("Enter", [], target);
  }

  return { ok: true, length: text.length };
}

export async function humanPressKey(
  key: string,
  modifiers: string[] = [],
  target?: ElementTarget,
): Promise<{ ok: true }> {
  let el: Element = document.activeElement ?? document.body;
  if (target) {
    const r = resolveTarget(target, getSomMap());
    if (r.element) {
      el = r.element;
      if (el instanceof HTMLElement) el.focus();
    }
  }
  const flags = modifiersToFlags(modifiers);
  const opts = { key, bubbles: true, cancelable: true, ...flags };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keypress", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
  return { ok: true };
}

export async function humanHover(target: ElementTarget): Promise<{ ok: true }> {
  const resolved = resolveTarget(target, getSomMap());
  await moveMouseTo(resolved.x!, resolved.y!);
  dispatchMouse("mouseover", resolved.x!, resolved.y!);
  dispatchMouse("mouseenter", resolved.x!, resolved.y!);
  if (resolved.element instanceof HTMLElement) {
    resolved.element.dispatchEvent(
      new MouseEvent("mouseenter", { bubbles: true }),
    );
  }
  return { ok: true };
}

export async function humanDragDrop(
  source: ElementTarget,
  target: ElementTarget,
): Promise<{ ok: true }> {
  const s = resolveTarget(source, getSomMap());
  const t = resolveTarget(target, getSomMap());
  await moveMouseTo(s.x!, s.y!);
  dispatchMouse("mousedown", s.x!, s.y!, { buttons: 1 });
  const path = bezierPath(s.x!, s.y!, t.x!, t.y!, 24);
  for (const p of path) {
    dispatchMouse("mousemove", p.x, p.y, { buttons: 1 });
    lastMouse = p;
    await sleep(randomBetween(6, 16));
  }
  dispatchMouse("mouseup", t.x!, t.y!, { buttons: 0 });

  // HTML5 DnD events
  if (s.element && t.element) {
    const dt = new DataTransfer();
    s.element.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }),
    );
    t.element.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }),
    );
    t.element.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, dataTransfer: dt }),
    );
    t.element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
    );
    s.element.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, dataTransfer: dt }),
    );
  }
  return { ok: true };
}

export async function humanScroll(options: {
  direction?: string;
  amount?: number;
  target?: ElementTarget;
}): Promise<{ ok: true; scrollX: number; scrollY: number }> {
  const amount = options.amount ?? 600;
  if (options.target) {
    const r = resolveTarget(options.target, getSomMap());
    r.element?.scrollIntoView({ block: "center", behavior: "smooth" });
    await sleep(300);
  } else {
    const dir = options.direction ?? "down";
    let dx = 0;
    let dy = 0;
    switch (dir) {
      case "up":
        dy = -amount;
        break;
      case "down":
        dy = amount;
        break;
      case "left":
        dx = -amount;
        break;
      case "right":
        dx = amount;
        break;
      case "top":
        window.scrollTo({ top: 0, behavior: "smooth" });
        await sleep(200);
        return { ok: true, scrollX: window.scrollX, scrollY: window.scrollY };
      case "bottom":
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth",
        });
        await sleep(200);
        return { ok: true, scrollX: window.scrollX, scrollY: window.scrollY };
    }
    window.scrollBy({ left: dx, top: dy, behavior: "smooth" });
    await sleep(200);
  }
  return { ok: true, scrollX: window.scrollX, scrollY: window.scrollY };
}

export async function humanSelectOption(
  target: ElementTarget,
  opts: { value?: string; label?: string; index?: number },
): Promise<{ ok: true; value: string }> {
  const r = resolveTarget(target, getSomMap());
  const el = r.element;
  if (!(el instanceof HTMLSelectElement)) {
    throw new Error("Target is not a <select> element");
  }
  if (opts.value !== undefined) {
    el.value = opts.value;
  } else if (opts.label !== undefined) {
    const option = Array.from(el.options).find(
      (o) => o.text.trim() === opts.label || o.label === opts.label,
    );
    if (!option) throw new Error(`Option label not found: ${opts.label}`);
    el.value = option.value;
  } else if (opts.index !== undefined) {
    el.selectedIndex = opts.index;
  } else {
    throw new Error("Provide value, label, or index");
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: el.value };
}

export function pageInfo() {
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    userAgent: navigator.userAgent,
  };
}
