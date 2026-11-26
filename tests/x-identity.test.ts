import { describe, expect, it } from "vitest";
import { detectXUsername, xIdentityParsing } from "@cenblu/shared/x-identity";

function fakePage(hrefBySelector: Record<string, string | null>) {
  const visited: string[] = [];
  const locator = (selector: string) => ({
    first() { return this; },
    async innerText() { return ""; },
    async getAttribute(name: string) { return name === "href" ? hrefBySelector[selector] ?? null : null; },
    async click() {},
  });
  return {
    visited,
    page: {
      locator,
      keyboard: { press: async () => undefined },
      waitForTimeout: async () => undefined,
      evaluate: async () => null,
      goto: async (url: string) => { visited.push(url); },
    },
  };
}

describe("X identity parsing", () => {
  it("extracts usernames from account text", () => {
    expect(xIdentityParsing.usernameFromText("Display Name\n@Account_Name")).toBe("account_name");
    expect(xIdentityParsing.usernameFromText("Account menu")).toBeNull();
  });

  it("extracts profile navigation paths and rejects application routes", () => {
    expect(xIdentityParsing.usernameFromHref("/Account_Name")).toBe("account_name");
    expect(xIdentityParsing.usernameFromHref("/Account_Name?ref=sidebar")).toBe("account_name");
    expect(xIdentityParsing.usernameFromHref("/home")).toBeNull();
    expect(xIdentityParsing.usernameFromHref("/i/bookmarks")).toBeNull();
  });

  it("detects the signed-in handle from the profile link when the account menu test id is gone", async () => {
    const { page, visited } = fakePage({ "a[data-testid='AppTabBar_Profile_Link'], a[aria-label='Profile']": "/Account_Name" });
    expect(await detectXUsername(page as never, "[data-testid='SideNav_AccountSwitcher_Button']")).toBe("account_name");
    expect(await detectXUsername(page as never, "[data-testid='SideNav_AccountSwitcher_Button']", true)).toBe("account_name");
    expect(visited).toContain("https://x.com/account_name");
  });

  it("ignores a profile link that points at an application route", async () => {
    const { page } = fakePage({ "a[data-testid='AppTabBar_Profile_Link'], a[aria-label='Profile']": "/home" });
    expect(await detectXUsername(page as never, "[data-testid='SideNav_AccountSwitcher_Button']")).toBeNull();
  });
});
