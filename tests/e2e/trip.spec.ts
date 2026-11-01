/**
 * End-to-end flow: login → project → day → stops → transport → drag → reload → failure/retry.
 *
 *   BASE_URL=http://localhost:8080 E2E_USER=admin E2E_PASS=... npx playwright test
 *
 * If the system has no admin yet, the test performs the initial setup with
 * E2E_USER / E2E_PASS. Run against a test instance: it creates a project.
 */
import { expect, test, type Page } from "@playwright/test";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "e2e-password-123";
const PROJECT = `E2E 東京 ${Date.now()}`;

async function login(page: Page) {
  await page.goto("/");
  const setup = page.getByText("初始設定：建立管理者帳號");
  const loginHeading = page.getByText("請登入");
  const projects = page.getByRole("dialog", { name: "專案" });
  await expect(setup.or(loginHeading).or(projects).or(page.getByRole("button", { name: "＋ 新增地點" }))).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel("帳號").fill(USER);
    await page.getByLabel("密碼", { exact: true }).fill(PASS);
    await page.getByLabel("確認密碼").fill(PASS);
    await page.getByRole("button", { name: "建立並登入" }).click();
  } else if (await loginHeading.isVisible()) {
    await page.getByLabel("帳號").fill(USER);
    await page.getByLabel("密碼").fill(PASS);
    await page.getByRole("button", { name: "登入" }).click();
  }
}

async function addStopAt(page: Page, name: string, x: number, y: number) {
  await page.getByRole("button", { name: "＋ 新增地點" }).click();
  await expect(page.getByText("點擊地圖以放置新地點")).toBeVisible();
  const map = page.locator(".leaflet-container");
  await map.click({ position: { x, y } });
  await page.getByLabel("名稱 *").fill(name);
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "地點詳情" })).toBeVisible();
  await expect(page.getByTestId("stop-item").filter({ hasText: name })).toBeVisible();
}

const saved = (page: Page) => expect(page.getByTestId("save-status")).toContainText("已儲存");

test("plan a day, record transport, drag, persist, and recover from failures", async ({ page }) => {
  await login(page);

  // create project
  const dialog = page.getByRole("dialog", { name: "專案" });
  await expect(dialog.or(page.getByRole("button", { name: "＋ 新增地點" }))).toBeVisible();
  if (!(await dialog.isVisible())) await page.getByTitle("切換專案").click();
  await dialog.getByPlaceholder("新專案名稱").fill(PROJECT);
  await dialog.getByRole("button", { name: "建立" }).click();
  await expect(dialog).toBeHidden();

  // day + filter to it so new stops land in that day
  await page.getByRole("button", { name: "＋ 新增日期" }).click();
  await expect(page.getByRole("heading", { name: "日期設定" })).toBeVisible();
  await page.getByLabel("日期", { exact: true }).fill("2026-11-05");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await saved(page);
  await page.getByLabel("日期篩選").selectOption({ label: "11/5（四）" });

  // AC-01: three stops
  await addStopAt(page, "飯店", 300, 250);
  await addStopAt(page, "車站", 450, 380);
  await addStopAt(page, "景點", 600, 300);
  await expect(page.getByTestId("stop-item")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /未設定交通方式/ })).toHaveCount(2);

  // AC-03: transport for 飯店→車站 only
  await page.getByRole("button", { name: /未設定交通方式/ }).first().click();
  await expect(page.getByRole("heading", { name: /飯店.*車站/ })).toBeVisible();
  await page.getByLabel("交通方式").selectOption("walk");
  await page.getByLabel("所需時間（分鐘）").fill("15");
  await page.getByRole("button", { name: "儲存變更" }).click();
  await saved(page);
  await expect(page.getByRole("button", { name: /步行・15 分鐘/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /未設定交通方式/ })).toHaveCount(1);

  // AC-02: drag 飯店 marker and check coordinates are saved
  await page.getByTestId("stop-item").filter({ hasText: "飯店" }).getByRole("button", { name: "飯店", exact: true }).click();
  const latBefore = await page.getByLabel("緯度 *").inputValue();
  const marker = page.locator('.leaflet-marker-icon[title="飯店"]');
  const box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 90, { steps: 10 });
  await page.mouse.up();
  await saved(page);
  await expect(page.getByLabel("緯度 *")).not.toHaveValue(latBefore);
  const latAfter = await page.getByLabel("緯度 *").inputValue();

  // SYS-01: reload — everything persists
  await page.reload();
  await expect(page.getByTestId("stop-item")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /步行・15 分鐘/ })).toBeVisible();
  await page.getByTestId("stop-item").filter({ hasText: "飯店" }).getByRole("button", { name: "飯店", exact: true }).click();
  await expect(page.getByLabel("緯度 *")).toHaveValue(latAfter);

  // AC-04: reorder → 飯店 goes last; recorded walk leg must not attach to a new pair
  const handle = page.getByRole("button", { name: "拖曳排序 飯店" });
  const target = page.getByRole("button", { name: "拖曳排序 景點" });
  const hb = (await handle.boundingBox())!;
  const tb = (await target.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 10, { steps: 3 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height + 8, { steps: 15 });
  await page.mouse.up();
  await saved(page);
  await expect(page.getByTestId("stop-item").first()).toContainText("車站");
  await expect(page.getByTestId("stop-item").last()).toContainText("飯店");
  await expect(page.getByRole("button", { name: /步行/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /未設定交通方式/ })).toHaveCount(2);

  // Google Maps link → stop is created and placed automatically (coordinates parsed from the URL)
  const link =
    "https://www.google.com/maps/place/%E6%B7%BA%E8%8D%89%E5%AF%BA/@35.7147651,139.7940837,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.7147651!4d139.7966586";
  await page.getByLabel("從 Google 地圖連結新增").fill(link);
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByTestId("gmaps-notice")).toContainText("已新增「淺草寺」");
  await expect(page.getByTestId("stop-item").filter({ hasText: "淺草寺" })).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon[title="淺草寺"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "地點詳情" })).toBeVisible();
  await expect(page.getByLabel("緯度 *")).toHaveValue("35.714765");
  await expect(page.getByLabel("參考網址")).toHaveValue(link);
  await saved(page);
  await page.getByTestId("stop-item").filter({ hasText: "飯店" }).getByRole("button", { name: "飯店", exact: true }).click();

  // AC-09: API unreachable → 儲存失敗 + retry, never 已儲存
  await page.route("**/api/v1/stops/**", (r) => r.abort("connectionrefused"));
  await page.getByLabel("名稱 *").fill("飯店（改）");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByTestId("save-error")).toContainText("儲存失敗");
  await expect(page.getByTestId("save-status")).not.toContainText("已儲存");
  await page.unroute("**/api/v1/stops/**");
  await page.getByRole("button", { name: "重試" }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByTestId("stop-item").filter({ hasText: "飯店（改）" })).toBeVisible();
});
