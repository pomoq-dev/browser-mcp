import { z } from "zod";

export const ElementTargetSchema = z.union([
  z.object({ som_id: z.number().int().nonnegative() }),
  z.object({ selector: z.string().min(1) }),
  z.object({ xpath: z.string().min(1) }),
  z.object({
    coordinates: z.object({
      x: z.number(),
      y: z.number(),
    }),
  }),
]);

export const GetVisualStateSchema = z.object({
  full_page: z.boolean().optional().default(false),
  draw_labels: z.boolean().optional().default(true),
  element_types: z
    .array(z.string())
    .optional()
    .default([
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
      "[contenteditable=true]",
    ]),
  tab_id: z.number().int().optional(),
});

export const GetDomTreeSchema = z.object({
  max_depth: z.number().int().positive().optional().default(12),
  include_invisible: z.boolean().optional().default(false),
  selector: z.string().optional(),
  tab_id: z.number().int().optional(),
});

export const ClickSchema = z.object({
  target: ElementTargetSchema,
  click_type: z
    .enum(["left", "right", "double", "middle"])
    .optional()
    .default("left"),
  modifiers: z
    .array(z.enum(["Shift", "Control", "Alt", "Meta"]))
    .optional()
    .default([]),
  tab_id: z.number().int().optional(),
});

export const TypeTextSchema = z.object({
  target: ElementTargetSchema,
  text: z.string(),
  clear_first: z.boolean().optional().default(true),
  press_enter: z.boolean().optional().default(false),
  delay_ms: z.number().int().nonnegative().optional().default(30),
  tab_id: z.number().int().optional(),
});

export const DragAndDropSchema = z.object({
  source: ElementTargetSchema,
  target: ElementTargetSchema,
  tab_id: z.number().int().optional(),
});

export const UploadFileSchema = z.object({
  selector: z.string().min(1),
  file_paths: z.array(z.string().min(1)).min(1),
  tab_id: z.number().int().optional(),
});

export const ExecJsPageSchema = z.object({
  code: z.string().min(1),
  args: z.array(z.unknown()).optional().default([]),
  tab_id: z.number().int().optional(),
  timeout_ms: z.number().int().positive().optional().default(30_000),
});

export const RunNodePlaywrightSchema = z.object({
  script: z.string().min(1),
  timeout_ms: z.number().int().positive().optional().default(60_000),
  cdp_endpoint: z.string().optional(),
});

export const RunNodeScriptSchema = z.object({
  script: z.string().min(1),
  timeout_ms: z.number().int().positive().optional().default(30_000),
});

export const ManageCookiesSchema = z.object({
  action: z.enum(["get", "set", "delete", "export_all", "clear"]),
  cookie_data: z
    .object({
      name: z.string().optional(),
      value: z.string().optional(),
      url: z.string().optional(),
      domain: z.string().optional(),
      path: z.string().optional(),
      secure: z.boolean().optional(),
      httpOnly: z.boolean().optional(),
      expirationDate: z.number().optional(),
      sameSite: z.enum(["no_restriction", "lax", "strict"]).optional(),
    })
    .optional(),
  url: z.string().optional(),
  tab_id: z.number().int().optional(),
});

export const ManageStorageSchema = z.object({
  storage_type: z.enum(["local", "session"]),
  action: z.enum(["get", "set", "remove", "clear", "get_all"]),
  key: z.string().optional(),
  value: z.string().optional(),
  tab_id: z.number().int().optional(),
});

export const InterceptNetworkSchema = z.object({
  action: z.enum(["add", "remove", "list", "clear"]),
  rule_id: z.string().optional(),
  url_pattern: z.string().optional(),
  intercept_action: z.enum(["block", "mock", "log"]).optional(),
  mock_response: z
    .object({
      status: z.number().int().optional(),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
    })
    .optional(),
});

export const ExtractDataSchema = z.object({
  schema: z.record(z.unknown()),
  output_format: z.enum(["json", "csv", "markdown"]).optional().default("json"),
  multiple: z.boolean().optional().default(false),
  container_selector: z.string().optional(),
  tab_id: z.number().int().optional(),
});

export const GeneratePdfSchema = z.object({
  selector: z.string().optional(),
  landscape: z.boolean().optional().default(false),
  print_background: z.boolean().optional().default(true),
  tab_id: z.number().int().optional(),
});

export const NavigateSchema = z.object({
  url: z.string().min(1),
  tab_id: z.number().int().optional(),
  new_tab: z.boolean().optional().default(false),
  wait_until: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .optional()
    .default("load"),
});

export const ScrollSchema = z.object({
  direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).optional(),
  amount: z.number().optional().default(600),
  target: ElementTargetSchema.optional(),
  tab_id: z.number().int().optional(),
});

export const PressKeySchema = z.object({
  key: z.string().min(1),
  modifiers: z
    .array(z.enum(["Shift", "Control", "Alt", "Meta"]))
    .optional()
    .default([]),
  target: ElementTargetSchema.optional(),
  tab_id: z.number().int().optional(),
});

export const HoverSchema = z.object({
  target: ElementTargetSchema,
  tab_id: z.number().int().optional(),
});

export const SelectOptionSchema = z.object({
  target: ElementTargetSchema,
  value: z.string().optional(),
  label: z.string().optional(),
  index: z.number().int().optional(),
  tab_id: z.number().int().optional(),
});

export const WaitForSchema = z.object({
  condition: z.enum([
    "selector",
    "text",
    "url",
    "timeout",
    "network_idle",
  ]),
  selector: z.string().optional(),
  text: z.string().optional(),
  url_pattern: z.string().optional(),
  timeout_ms: z.number().int().positive().optional().default(15_000),
  tab_id: z.number().int().optional(),
});

export const RecordMacroStartSchema = z.object({
  name: z.string().optional(),
});

export const RecordMacroStopSchema = z.object({
  name: z.string().optional(),
  generate_script: z.boolean().optional().default(true),
});

export const ExecuteMacroSchema = z.object({
  macro_id: z.string().min(1),
  variables: z.record(z.string()).optional().default({}),
  tab_id: z.number().int().optional(),
});

export const RegisterWatchdogSchema = z.object({
  name: z.string().optional(),
  url: z.string().min(1),
  interval_sec: z.number().positive().optional().default(60),
  condition: z.object({
    type: z.enum([
      "selector_exists",
      "selector_missing",
      "text_contains",
      "js_condition",
      "url_matches",
    ]),
    selector: z.string().optional(),
    text: z.string().optional(),
    code: z.string().optional(),
    pattern: z.string().optional(),
  }),
  action_on_match: z
    .object({
      notify: z.boolean().optional().default(true),
      trigger_mcp_event: z.string().optional(),
      exec_js: z.string().optional(),
      click_selector: z.string().optional(),
    })
    .optional()
    .default({ notify: true }),
});

export const TabsSchema = z.object({
  tab_id: z.number().int().optional(),
});

export const ScreenshotSchema = z.object({
  full_page: z.boolean().optional().default(false),
  tab_id: z.number().int().optional(),
});

export function toolResult(data: unknown, isError = false) {
  const text =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

export function toolImageResult(
  base64: string,
  mimeType: string,
  meta?: unknown,
) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [
    {
      type: "image",
      data: base64.replace(/^data:[^;]+;base64,/, ""),
      mimeType,
    },
  ];
  if (meta !== undefined) {
    content.unshift({
      type: "text",
      text: typeof meta === "string" ? meta : JSON.stringify(meta, null, 2),
    });
  }
  return { content };
}
