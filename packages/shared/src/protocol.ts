/**
 * Shared wire protocol between MCP Server and Chrome Extension over WebSocket.
 */

export const DEFAULT_WS_PORT = 17373;
export const DEFAULT_WS_HOST = "127.0.0.1";
export const PROTOCOL_VERSION = 1;

/** Target resolution for interactions */
export type ElementTarget =
  | { som_id: number }
  | { selector: string }
  | { coordinates: { x: number; y: number } }
  | { xpath: string };

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SomElement {
  id: number;
  tag: string;
  role?: string;
  type?: string;
  text: string;
  name?: string;
  href?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  bbox: BoundingBox;
  selector: string;
  xpath: string;
  visible: boolean;
  enabled: boolean;
}

export interface DomTreeNode {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  attrs?: Record<string, string>;
  selector: string;
  xpath: string;
  bbox?: BoundingBox;
  children: DomTreeNode[];
}

export type BridgeRequestType =
  | "ping"
  | "get_tabs"
  | "get_active_tab"
  | "navigate"
  | "go_back"
  | "go_forward"
  | "reload"
  | "close_tab"
  | "new_tab"
  | "switch_tab"
  | "get_visual_state"
  | "get_dom_tree"
  | "click"
  | "type_text"
  | "press_key"
  | "scroll"
  | "hover"
  | "drag_and_drop"
  | "upload_file"
  | "select_option"
  | "exec_js"
  | "get_page_info"
  | "screenshot"
  | "manage_cookies"
  | "manage_storage"
  | "intercept_network"
  | "extract_data"
  | "generate_pdf"
  | "record_macro_start"
  | "record_macro_stop"
  | "list_macros"
  | "execute_macro"
  | "delete_macro"
  | "register_watchdog"
  | "list_watchdogs"
  | "remove_watchdog"
  | "wait_for"
  | "get_console_logs"
  | "clear_console_logs"
  | "get_network_logs"
  | "clear_network_logs";

export interface BridgeRequest {
  id: string;
  type: BridgeRequestType;
  payload?: Record<string, unknown>;
  tabId?: number;
  timeoutMs?: number;
}

export interface BridgeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  stack?: string;
}

export interface BridgeEvent {
  event: string;
  payload: unknown;
  timestamp: number;
}

export type ExtensionToServerMessage =
  | { kind: "hello"; version: number; extensionId: string }
  | { kind: "response"; response: BridgeResponse }
  | { kind: "event"; event: BridgeEvent }
  | { kind: "heartbeat"; ts: number };

export type ServerToExtensionMessage =
  | { kind: "hello_ack"; version: number; port: number }
  | { kind: "request"; request: BridgeRequest }
  | { kind: "heartbeat_ack"; ts: number };

/** Macro recording types */
export interface MacroAction {
  type:
    | "click"
    | "type"
    | "keydown"
    | "scroll"
    | "navigate"
    | "select"
    | "submit"
    | "focus"
    | "change";
  timestamp: number;
  url: string;
  selector?: string;
  xpath?: string;
  text?: string;
  value?: string;
  key?: string;
  coordinates?: { x: number; y: number };
  semantic?: string;
}

export interface Macro {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  actions: MacroAction[];
  generatedScript?: string;
  variables?: string[];
}

/** Watchdog types */
export type WatchdogCondition =
  | { type: "selector_exists"; selector: string }
  | { type: "selector_missing"; selector: string }
  | { type: "text_contains"; selector?: string; text: string }
  | { type: "js_condition"; code: string }
  | { type: "url_matches"; pattern: string };

export interface WatchdogAction {
  notify?: boolean;
  trigger_mcp_event?: string;
  exec_js?: string;
  click_selector?: string;
}

export interface Watchdog {
  id: string;
  name?: string;
  url: string;
  intervalSec: number;
  condition: WatchdogCondition;
  actionOnMatch: WatchdogAction;
  enabled: boolean;
  lastCheck?: number;
  lastMatch?: number;
  matchCount: number;
  createdAt: number;
}

export interface NetworkInterceptRule {
  id: string;
  urlPattern: string;
  action: "block" | "mock" | "log";
  mockResponse?: {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  };
  enabled: boolean;
}

export interface ExtractSchema {
  [key: string]: string | ExtractSchema | ExtractSchema[];
}

export function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
