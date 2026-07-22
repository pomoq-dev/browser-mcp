import type { Macro, MacroAction } from "@browser-mcp/shared";

const KEY = "macros";

function id(): string {
  return `macro_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function listMacros(): Promise<Macro[]> {
  const data = await chrome.storage.local.get(KEY);
  return (data[KEY] as Macro[]) ?? [];
}

export async function saveMacro(macro: Macro): Promise<Macro> {
  const macros = await listMacros();
  const idx = macros.findIndex((m) => m.id === macro.id);
  if (idx >= 0) macros[idx] = macro;
  else macros.push(macro);
  await chrome.storage.local.set({ [KEY]: macros });
  return macro;
}

export async function createMacro(
  name: string,
  actions: MacroAction[],
  generatedScript?: string,
): Promise<Macro> {
  const macro: Macro = {
    id: id(),
    name,
    createdAt: Date.now(),
    actions,
    generatedScript,
  };
  return saveMacro(macro);
}

export async function getMacro(macroId: string): Promise<Macro | undefined> {
  const macros = await listMacros();
  return macros.find((m) => m.id === macroId);
}

export async function deleteMacro(macroId: string): Promise<boolean> {
  const macros = await listMacros();
  const next = macros.filter((m) => m.id !== macroId);
  await chrome.storage.local.set({ [KEY]: next });
  return next.length < macros.length;
}
