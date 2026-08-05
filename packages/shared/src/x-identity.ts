type LocatorLike = {
  first(): LocatorLike;
  innerText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  click(): Promise<void>;
};

export type XIdentityPage = {
  locator(selector: string): LocatorLike;
  keyboard: { press(key: string): Promise<void> };
  waitForTimeout(milliseconds: number): Promise<void>;
  evaluate<T>(operation: () => Promise<T>): Promise<T>;
  goto(url: string): Promise<unknown>;
};

const reservedPaths = new Set(["home", "explore", "notifications", "messages", "search", "settings", "compose", "login", "logout", "i"]);

function usernameFromText(value: string): string | null {
  return value.match(/@([A-Za-z0-9_]{1,15})/)?.[1]?.toLowerCase() ?? null;
}

function usernameFromHref(value: string | null): string | null {
  if (!value) return null;
  const match = /^\/([A-Za-z0-9_]{1,15})\/?(?:\?.*)?$/.exec(value);
  const username = match?.[1]?.toLowerCase();
  return username && !reservedPaths.has(username) ? username : null;
}

export async function detectXUsername(page: XIdentityPage, accountMenuSelector: string, navigateToProfile = false): Promise<string | null> {
  const finish = async (username: string | null): Promise<string | null> => {
    if (username && navigateToProfile) await page.goto(`https://x.com/${username}`).catch(() => undefined);
    return username;
  };
  const profileHref = await page.locator("a[data-testid='AppTabBar_Profile_Link']").first().getAttribute("href").catch(() => null);
  const profileUsername = usernameFromHref(profileHref);
  if (profileUsername) return finish(profileUsername);

  const accountMenu = page.locator(accountMenuSelector).first();
  const menuText = await accountMenu.innerText().catch(() => "");
  const textUsername = usernameFromText(menuText);
  if (textUsername) return finish(textUsername);

  const menuLabel = await accountMenu.getAttribute("aria-label").catch(() => null);
  const labelUsername = usernameFromText(menuLabel ?? "");
  if (labelUsername) return finish(labelUsername);

  try {
    await accountMenu.click();
    await page.waitForTimeout(250);
    const expandedText = await page.locator("[role='menu']").first().innerText().catch(() => "");
    const expandedUsername = usernameFromText(expandedText);
    if (expandedUsername) return finish(expandedUsername);
    const expandedHref = await page.locator("[role='menu'] a[href^='/']").first().getAttribute("href").catch(() => null);
    const hrefUsername = usernameFromHref(expandedHref);
    if (hrefUsername) return finish(hrefUsername);
  } finally {
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  const apiUsername = await page.evaluate(async () => {
    for (const endpoint of ["/i/api/1.1/account/settings.json", "https://api.x.com/1.1/account/settings.json"]) {
      try {
        const response = await fetch(endpoint, { credentials: "include" });
        if (!response.ok) continue;
        const data = await response.json() as { screen_name?: unknown };
        if (typeof data.screen_name === "string" && /^[A-Za-z0-9_]{1,15}$/.test(data.screen_name)) return data.screen_name.toLowerCase();
      } catch { /* Try the next authenticated endpoint. */ }
    }
    return null;
  }).catch(() => null);
  return finish(apiUsername);
}

export const xIdentityParsing = { usernameFromHref, usernameFromText };
