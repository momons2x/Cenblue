import { describe, expect, it } from "vitest";
import { commandHelp, commandPrefix, parseCommand } from "@cenblu/discord-bot";

describe("discord prefix commands", () => {
  it("parses a prefixed command", () => {
    expect(parseCommand("!status")).toBe("status");
    expect(parseCommand("!pipeline")).toBe("pipeline");
    expect(parseCommand("!test")).toBe("test");
    expect(parseCommand("!help")).toBe("help");
  });

  it("is case-insensitive and tolerates leading whitespace", () => {
    expect(parseCommand("  !STATUS")).toBe("status");
    expect(parseCommand("!Pipeline")).toBe("pipeline");
  });

  it("ignores non-command messages", () => {
    expect(parseCommand("hello there")).toBeNull();
    expect(parseCommand("!")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("!/status")).toBe("/status");
  });

  it("ignores content after the command word", () => {
    expect(parseCommand("!status details here")).toBe("status");
  });

  it("exposes the prefix and help text", () => {
    expect(commandPrefix).toBe("!");
    expect(commandHelp).toContain("!status");
  });
});
