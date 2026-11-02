import { expect, test } from "@playwright/test";
import path from "node:path";

const api = "http://localhost:3000/api/v1";
const evidence = (name: string) =>
  path.resolve(process.cwd(), "../docs/requisicoes-bpm/evidencias/P01", name);

const record = {
  id: "a23-request",
  code: "REQ-A23-0001",
  title: "Título original",
  description: "Descrição preservada",
  fields: { quantity: 1 },
  schema: [{ key: "quantity", label: "Quantidade", type: "integer" }],
  formAccess: {},
  status: "rascunho",
  currentVersion: 7,
  cycle: 0,
  category: { id: "category-a23", code: "A23", name: "Processo A23" },
  version: 1,
  allowedActions: ["saveDraft", "submit"],
  attachments: [],
  activities: [],
  comments: [],
  sla: [],
};

test("A23 — 390px, teclado, offline/retry/vazio e conflito sem perder dados", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const claims = Buffer.from(
    JSON.stringify({
      sub: "a23-user",
      email: "a23@example.invalid",
      roles: ["synthetic"],
      permissions: ["request:read", "request:create"],
      collaboratorId: "a23-collaborator",
      mustChangePassword: false,
    }),
  ).toString("base64url");
  await page.addInitScript((token) => {
    localStorage.setItem("axis_access_token", token);
  }, `eyJhbGciOiJub25lIn0.${claims}.synthetic`);

  await page.route(`${api}/bpm/capabilities`, (route) =>
    route.fulfill({ json: { enabled: true, permissions: [], nodes: [], limits: {} } }),
  );
  let requestAttempts = 0;
  await page.route("**/api/v1/bpm/requests*", (route) => {
    const url = route.request().url();
    if (url.endsWith("/a23-request")) return route.fulfill({ json: record });
    if (url.endsWith("/a23-request/timeline")) return route.fulfill({ json: [] });
    if (url.endsWith("/a23-request/draft"))
      return route.fulfill({
        status: 409,
        json: { error: { code: "VERSION_CONFLICT", message: "Conflito de versão" } },
      });
    requestAttempts += 1;
    if (requestAttempts <= 2)
      return route.fulfill({
        status: 503,
        json: { error: { code: "OFFLINE", message: "Offline" } },
      });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.route(`${api}/requests/queue**`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`${api}/bpm/requests/a23-request`, (route) =>
    route.fulfill({ json: record }),
  );
  await page.route(`${api}/bpm/requests/a23-request/timeline`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`${api}/bpm/requests/a23-request/draft`, (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "VERSION_CONFLICT", message: "Conflito de versão" } },
    }),
  );
  await page.route("**/api/v1/bpm/requests/a23-request/draft", (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "VERSION_CONFLICT", message: "Conflito de versão" } },
    }),
  );

  await page.goto("/requests/bpm");
  await expect(page.getByRole("alert")).toContainText("Offline");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: evidence("a23-390-offline.png"), fullPage: true });

  const menu = page.getByRole("button", { name: /menu/ });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: evidence("a23-390-menu.png"), fullPage: true });
  await menu.press("Enter");

  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("status")).toContainText("Nenhuma requisição nesta visão");
  await page.screenshot({ path: evidence("a23-390-empty-after-retry.png"), fullPage: true });

  await page.goto("/requests/bpm/a23-request");
  const title = page.getByRole("textbox", { name: "Título" });
  await expect(title).toHaveValue("Título original");
  await title.fill("Título preservado no conflito");
  await page.getByRole("button", { name: "Salvar agora" }).click();
  await expect(page.getByText("Conflito detectado. Suas edições foram preservadas.")).toBeVisible();
  await expect(title).toHaveValue("Título preservado no conflito");
  await expect(
    page.getByText("Conflito detectado. Suas edições foram preservadas.").locator(".."),
  ).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: evidence("a23-390-conflict-preserved.png"), fullPage: true });
});
