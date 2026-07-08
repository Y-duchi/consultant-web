import { writeFile } from "node:fs/promises";

const devtoolsOrigin = process.argv[2] ?? "http://127.0.0.1:9223";
const appOrigin = process.argv[3] ?? "http://127.0.0.1:5173";

const target = await fetch(`${devtoolsOrigin}/json/new?${encodeURIComponent(`${appOrigin}/login`)}`, {
  method: "PUT",
}).then((response) => response.json());

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const runtimeErrors = [];
let nextId = 1;

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  if (payload.id && pending.has(payload.id)) {
    pending.get(payload.id)(payload);
    pending.delete(payload.id);
  }
  if (payload.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(payload.params.exceptionDetails.text);
  }
  if (payload.method === "Log.entryAdded" && payload.params.entry.level === "error") {
    runtimeErrors.push(payload.params.entry.text);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

async function cdp(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  const result = await new Promise((resolve) => pending.set(id, resolve));
  if (result.error) {
    throw new Error(`${method}: ${result.error.message}`);
  }
  return result.result;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function textIncludes(expected) {
  const result = await cdp("Runtime.evaluate", {
    expression: `document.body.innerText.includes(${JSON.stringify(expected)})`,
    returnByValue: true,
  });
  return Boolean(result.result.value);
}

async function go(path) {
  await cdp("Page.navigate", { url: `${appOrigin}${path}` });
  await wait(1000);
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Log.enable");
await wait(1000);
await cdp("Runtime.evaluate", { expression: "window.localStorage.clear()" });
await go("/login");

const loginReady = (await textIncludes("AURA 파트너 매니저")) && (await textIncludes("업체/전문가 로그인"));
await cdp("Runtime.evaluate", {
  expression: `document.querySelector('button[type="submit"]').click()`,
});
await wait(1200);

const dashboardReady = (await textIncludes("오늘 앱에서 들어온 뷰티 상담 운영")) && (await textIncludes("처리 필요"));
await go("/workspace/bookings");
const bookingsReady = (await textIncludes("앱 예약 관리")) && (await textIncludes("가능 시간 조정")) && (await textIncludes("월")) && (await textIncludes("일"));
await go("/workspace/chat");
const chatReady = (await textIncludes("고객 대화")) && (await textIncludes("고객 프로필")) && (await textIncludes("전송"));
await go("/workspace/completion");
const completionReady = (await textIncludes("상담 완료 및 처방 노트 전달")) && (await textIncludes("완료 처리할 예약"));

const overlayResult = await cdp("Runtime.evaluate", {
  expression: `Boolean(document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]'))`,
  returnByValue: true,
});
const hasContentResult = await cdp("Runtime.evaluate", {
  expression: `document.body.innerText.trim().length > 0`,
  returnByValue: true,
});

const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
const screenshotPath = "/private/tmp/consulting-web-verified.png";
await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

await fetch(`${devtoolsOrigin}/json/close/${target.id}`).catch(() => undefined);
socket.close();

const result = {
  loginReady,
  dashboardReady,
  bookingsReady,
  chatReady,
  completionReady,
  hasContent: Boolean(hasContentResult.result.value),
  overlay: Boolean(overlayResult.result.value),
  runtimeErrors,
  screenshotPath,
};

console.log(JSON.stringify(result, null, 2));

if (!loginReady || !dashboardReady || !bookingsReady || !chatReady || !completionReady || result.overlay || runtimeErrors.length > 0) {
  process.exitCode = 1;
}
