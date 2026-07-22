function textOf(el: Element | null): string {
  if (!el) return "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function extractBySelector(selector: string, root: ParentNode = document): string {
  const el = root.querySelector(selector);
  if (!el) return "";
  if (el instanceof HTMLImageElement) return el.src;
  if (el instanceof HTMLAnchorElement) return el.href || textOf(el);
  return textOf(el);
}

function extractValue(
  schema: unknown,
  root: ParentNode,
): unknown {
  if (typeof schema === "string") {
    return extractBySelector(schema, root);
  }
  if (Array.isArray(schema)) {
    // first item defines item schema; parent keys handled by caller
    return schema.map((s) => extractValue(s, root));
  }
  if (schema && typeof schema === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      obj[k] = extractValue(v, root);
    }
    return obj;
  }
  return null;
}

export function extractData(
  schema: Record<string, unknown>,
  options: {
    multiple?: boolean;
    containerSelector?: string;
    outputFormat?: "json" | "csv" | "markdown";
  } = {},
): unknown {
  const { multiple = false, containerSelector, outputFormat = "json" } = options;

  let data: unknown;
  if (multiple && containerSelector) {
    const containers = Array.from(document.querySelectorAll(containerSelector));
    data = containers.map((c) => extractValue(schema, c));
  } else if (multiple) {
    // treat each top-level selector as multi
    const firstKey = Object.keys(schema)[0];
    if (!firstKey) {
      data = [];
    } else {
      const firstSel = schema[firstKey];
      if (typeof firstSel === "string") {
        const nodes = Array.from(document.querySelectorAll(firstSel));
        data = nodes.map((node, i) => {
          const row: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(schema)) {
            if (typeof v === "string" && k === firstKey) {
              row[k] = textOf(node);
            } else if (typeof v === "string") {
              // relative: try within parent
              const parent = node.parentElement ?? document;
              const all = Array.from(parent.querySelectorAll(v));
              row[k] = textOf(all[i] ?? parent.querySelector(v));
            } else {
              row[k] = extractValue(v, document);
            }
          }
          return row;
        });
      } else {
        data = extractValue(schema, document);
      }
    }
  } else {
    data = extractValue(schema, document);
  }

  if (outputFormat === "json") return data;

  const rows = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : [data as Record<string, unknown>];

  if (outputFormat === "csv") {
    if (!rows.length) return "";
    const keys = Object.keys(rows[0] ?? {});
    const lines = [
      keys.join(","),
      ...rows.map((r) =>
        keys
          .map((k) => {
            const val = String(r?.[k] ?? "");
            return `"${val.replace(/"/g, '""')}"`;
          })
          .join(","),
      ),
    ];
    return lines.join("\n");
  }

  // markdown table
  if (!rows.length) return "";
  const keys = Object.keys(rows[0] ?? {});
  const header = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows
    .map(
      (r) =>
        `| ${keys.map((k) => String(r?.[k] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`,
    )
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}
