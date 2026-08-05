import { describe, expect, it } from "vitest";
import { xIdentityParsing } from "@cenblu/shared/x-identity";

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
});
