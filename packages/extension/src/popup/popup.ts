const statusBadge = document.getElementById("status-badge")!;
const statusUrl = document.getElementById("status-url")!;
const statusExt = document.getElementById("status-ext")!;
const hostInput = document.getElementById("host") as HTMLInputElement;
const portInput = document.getElementById("port") as HTMLInputElement;
const btnConnect = document.getElementById("btn-connect")!;
const btnDisconnect = document.getElementById("btn-disconnect")!;

async function refresh(): Promise<void> {
  const status = await chrome.runtime.sendMessage({
    channel: "browser-mcp",
    type: "get_status",
  });
  const connected = Boolean(status?.connected);
  statusBadge.textContent = connected ? "ON" : "OFF";
  statusBadge.className = `badge ${connected ? "on" : "off"}`;
  statusUrl.textContent = status?.url || "—";
  statusExt.textContent = status?.extensionId || "—";

  const stored = await chrome.storage.local.get(["wsHost", "wsPort"]);
  if (stored.wsHost) hostInput.value = String(stored.wsHost);
  if (stored.wsPort) portInput.value = String(stored.wsPort);
}

btnConnect.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    channel: "browser-mcp",
    type: "connect",
    host: hostInput.value.trim() || "127.0.0.1",
    port: Number(portInput.value) || 17373,
  });
  setTimeout(() => void refresh(), 300);
});

btnDisconnect.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    channel: "browser-mcp",
    type: "disconnect",
  });
  setTimeout(() => void refresh(), 200);
});

void refresh();
setInterval(() => void refresh(), 2000);
