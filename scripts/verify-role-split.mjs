import { writeFile } from "node:fs/promises";

const devtoolsOrigin = process.argv[2] ?? "http://127.0.0.1:9223";
const appOrigin = process.argv[3] ?? "http://127.0.0.1:5173";
const STORAGE_KEY = "consultant-web-auth";

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

async function go(path) {
  await cdp("Page.navigate", { url: `${appOrigin}${path}` });
  await wait(900);
}

async function textIncludes(expected) {
  const result = await cdp("Runtime.evaluate", {
    expression: `document.body.innerText.includes(${JSON.stringify(expected)})`,
    returnByValue: true,
  });
  return Boolean(result.result.value);
}

async function currentPath() {
  const result = await cdp("Runtime.evaluate", {
    expression: "window.location.pathname",
    returnByValue: true,
  });
  return String(result.result.value);
}

async function setInputValue(selector, value) {
  await cdp("Runtime.evaluate", {
    expression: `
      (() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `,
  });
}

async function setPasswordInputValue(index, value) {
  await cdp("Runtime.evaluate", {
    expression: `
      (() => {
        const input = document.querySelectorAll('input[type="password"]')[${index}];
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `,
  });
}

async function clickButtonByText(text) {
  await cdp("Runtime.evaluate", {
    expression: `
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.innerText.includes(${JSON.stringify(text)}))
        ?.click()
    `,
  });
  await wait(700);
}

async function setAuth(user) {
  await cdp("Runtime.evaluate", {
    expression: `window.localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(user))})`,
  });
}

async function clearAuth() {
  await cdp("Runtime.evaluate", { expression: "window.localStorage.clear()" });
}

function user(overrides) {
  return {
    id: "account-test",
    name: "Test User",
    email: "test@example.com",
    role: "business_manager",
    businessId: "biz-1",
    workspaceScope: "business_operations",
    applicationStatus: "approved",
    accountId: "account-test",
    ...overrides,
  };
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Log.enable");

await clearAuth();

await setAuth(user({
  id: "admin-user",
  name: "플랫폼 관리자",
  email: "admin@aura.example",
  role: "admin",
  businessId: "platform",
}));
await go("/admin");
const adminDashboardReady = (await currentPath()) === "/admin" && (await textIncludes("AURA Admin")) && (await textIncludes("입점, 예약, AI 요약 운영 현황"));
const adminSidebarOnly = (await textIncludes("운영 대시보드")) && !(await textIncludes("내 예약"));
await go("/workspace");
const adminWorkspaceBlocked = (await currentPath()) === "/admin";

await setAuth(user({
  id: "account-1",
  name: "도아 컬러 랩",
  email: "partner@aura.example",
  businessId: "biz-1",
  accountId: "account-1",
  passwordChangeRequired: true,
}));
await go("/workspace/customers");
const passwordChangeRedirect = (await currentPath()) === "/workspace/password" && (await textIncludes("새 비밀번호 설정"));
await setPasswordInputValue(0, "AuraSecure!2026");
await setPasswordInputValue(1, "AuraSecure!2026");
await clickButtonByText("비밀번호 설정 완료");
const passwordChangeCompleted = (await currentPath()) === "/workspace";
await go("/workspace/customers");
const passwordChangeUnlocksWorkspace = (await currentPath()) === "/workspace/customers" && (await textIncludes("내 고객 관리"));

await setAuth(user({
  id: "account-1",
  name: "도아 컬러 랩",
  email: "partner@aura.example",
  businessId: "biz-1",
}));
await go("/workspace/customers");
const partnerAWorkspaceReady = (await currentPath()) === "/workspace/customers" && (await textIncludes("AURA Workspace"));
const partnerASeesOwnCustomers = (await textIncludes("지은")) && (await textIncludes("수민")) && !(await textIncludes("서연"));
await go("/admin");
const partnerAdminBlocked = (await currentPath()) === "/workspace";

await setAuth(user({
  id: "account-2",
  name: "비비드 브로우 랩",
  email: "partner-b@aura.example",
  businessId: "biz-2",
}));
await go("/workspace/customers");
const partnerBSeesOwnCustomers = (await textIncludes("서연")) && !(await textIncludes("지은")) && !(await textIncludes("수민"));

await setAuth(user({
  id: "expert-exp-3",
  name: "박리안",
  email: "rian.park@example.com",
  role: "expert",
  businessId: "biz-1",
  expertId: "exp-3",
  workspaceScope: "expert_personal",
}));
await go("/workspace/bookings");
const expertSeesOwnBookings = (await textIncludes("하영")) && (await textIncludes("민서")) && !(await textIncludes("지은")) && !(await textIncludes("수민"));

const overlayResult = await cdp("Runtime.evaluate", {
  expression: `Boolean(document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]'))`,
  returnByValue: true,
});

const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
const screenshotPath = "/private/tmp/consulting-web-role-split.png";
await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

await fetch(`${devtoolsOrigin}/json/close/${target.id}`).catch(() => undefined);
socket.close();

const result = {
  adminDashboardReady,
  adminSidebarOnly,
  adminWorkspaceBlocked,
  passwordChangeRedirect,
  passwordChangeCompleted,
  passwordChangeUnlocksWorkspace,
  partnerAWorkspaceReady,
  partnerASeesOwnCustomers,
  partnerAdminBlocked,
  partnerBSeesOwnCustomers,
  expertSeesOwnBookings,
  overlay: Boolean(overlayResult.result.value),
  runtimeErrors,
  screenshotPath,
};

console.log(JSON.stringify(result, null, 2));

if (
  !adminDashboardReady ||
  !adminSidebarOnly ||
  !adminWorkspaceBlocked ||
  !passwordChangeRedirect ||
  !passwordChangeCompleted ||
  !passwordChangeUnlocksWorkspace ||
  !partnerAWorkspaceReady ||
  !partnerASeesOwnCustomers ||
  !partnerAdminBlocked ||
  !partnerBSeesOwnCustomers ||
  !expertSeesOwnBookings ||
  result.overlay ||
  runtimeErrors.length > 0
) {
  process.exitCode = 1;
}
