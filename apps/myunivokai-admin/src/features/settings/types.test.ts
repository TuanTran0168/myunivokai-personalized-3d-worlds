import { describe, expect, it } from "vitest";
import {
  groupSettings,
  settingBoundsHint,
  settingGroupLabel,
  settingInputKind,
  settingLeafLabel,
  UNKNOWN_SETTINGS_GROUP_LABEL,
  type SettingSummary
} from "./types";

function declaredSetting(key: string, overrides: Partial<SettingSummary> = {}): SettingSummary {
  return {
    key,
    type: "int",
    value: "5",
    defaultValue: "5",
    isDeclared: true,
    isOverridden: false,
    ...overrides
  };
}

describe("grouping the settings screen", () => {
  // The dotted scheme was chosen so the screen groups by prefix with no
  // category column and no frontend change when a setting is added. This is
  // that property, asserted against the nine keys actually shipped.
  it("groups by the first two key segments and keeps the registry's order", () => {
    const groups = groupSettings([
      declaredSetting("quota.ai.daily_limit.anonymous"),
      declaredSetting("quota.ai.daily_limit.account"),
      declaredSetting("auth.token.admin.access_ttl", { type: "duration" }),
      declaredSetting("auth.token.web.access_ttl", { type: "duration" }),
      declaredSetting("auth.token.invite_ttl", { type: "duration" }),
      declaredSetting("auth.lockout.max_failed_attempts"),
      declaredSetting("auth.lockout.duration", { type: "duration" })
    ]);

    expect(groups.map((group) => group.label)).toEqual(["quota.ai", "auth.token", "auth.lockout"]);
    expect(groups[0].settings.map((setting) => setting.key)).toEqual([
      "quota.ai.daily_limit.anonymous",
      "quota.ai.daily_limit.account"
    ]);
    // `auth.token.invite_ttl` has three segments where its siblings have four,
    // and still belongs in the same section — the scheme fixes the prefix, not
    // the segment count.
    expect(groups[1].settings.map((setting) => setting.key)).toEqual([
      "auth.token.admin.access_ttl",
      "auth.token.web.access_ttl",
      "auth.token.invite_ttl"
    ]);
  });

  // Orphans are separated by declaredness rather than by prefix, and this is
  // the case that shows why: an orphan's key still parses, because it was a
  // declared key once. Grouped by prefix it would sit among settings that can
  // be validated, where it reads as editable.
  it("puts every orphan in one group at the end, even one whose prefix is a real section", () => {
    const groups = groupSettings([
      declaredSetting("quota.ai.daily_limit.anonymous"),
      { key: "quota.ai.daily_limit.retired_tier", value: "3", isDeclared: false, isOverridden: true },
      { key: "auth.lockout.retired_window", value: "9m", isDeclared: false, isOverridden: true }
    ]);

    expect(groups.map((group) => group.label)).toEqual(["quota.ai", UNKNOWN_SETTINGS_GROUP_LABEL]);
    expect(groups[0].settings.map((setting) => setting.key)).toEqual(["quota.ai.daily_limit.anonymous"]);
    expect(groups[1].settings.map((setting) => setting.key)).toEqual([
      "quota.ai.daily_limit.retired_tier",
      "auth.lockout.retired_window"
    ]);
  });

  it("renders no groups at all for an empty list, rather than an empty section", () => {
    expect(groupSettings([])).toEqual([]);
  });

  it("labels a short key with the whole key rather than an empty heading", () => {
    expect(settingGroupLabel("auth.lockout.duration")).toBe("auth.lockout");
    expect(settingGroupLabel("auth.lockout")).toBe("auth.lockout");
    expect(settingGroupLabel("auth")).toBe("auth");
  });

  it("takes the last segment as the row's own label, which is the part that varies", () => {
    expect(settingLeafLabel("quota.ai.daily_limit.anonymous")).toBe("anonymous");
    expect(settingLeafLabel("auth.token.invite_ttl")).toBe("invite_ttl");
    expect(settingLeafLabel("auth")).toBe("auth");
  });
});

describe("choosing a control for a setting", () => {
  it("picks a control per declared type", () => {
    expect(settingInputKind(declaredSetting("quota.ai.daily_limit.account", { type: "int" }))).toBe("number");
    expect(settingInputKind(declaredSetting("auth.lockout.duration", { type: "duration" }))).toBe("text");
    expect(settingInputKind(declaredSetting("example.feature.toggle", { type: "bool" }))).toBe("boolean");
  });

  // A string setting's control is decided by whether the registry closed its
  // vocabulary, so a future choice setting needs no change here.
  it("gives a string setting a select only when the registry closed its vocabulary", () => {
    expect(settingInputKind(declaredSetting("example.banner.text", { type: "string" }))).toBe("text");
    expect(
      settingInputKind(
        declaredSetting("example.provider.name", { type: "string", allowedValues: ["mock", "gemini"] })
      )
    ).toBe("choice");
    // An empty list is not a closed vocabulary — it is the absence of one, and
    // a select with no options is a control nobody can use.
    expect(settingInputKind(declaredSetting("example.banner.text", { type: "string", allowedValues: [] }))).toBe("text");
  });

  // An orphan carries no type at all, and a fifth type could exist before this
  // screen knows about it. Either way the value must stay visible: falling
  // through to nothing would render a row with no control and no explanation.
  it("falls back to a text field for a type it does not recognise", () => {
    expect(settingInputKind({ key: "quota.ai.retired", value: "3", isDeclared: false, isOverridden: true })).toBe(
      "text"
    );
  });
});

describe("the hint under a setting's input", () => {
  it("states the range when the server declared one", () => {
    expect(
      settingBoundsHint(declaredSetting("auth.lockout.duration", { type: "duration", minimum: "1m", maximum: "1d" }))
    ).toBe("Between 1m and 1d");
  });

  it("states the vocabulary when there is one, in preference to a range", () => {
    expect(
      settingBoundsHint(
        declaredSetting("example.provider.name", {
          type: "string",
          allowedValues: ["mock", "gemini"],
          minimum: "1",
          maximum: "2"
        })
      )
    ).toBe("One of mock, gemini");
  });

  it("says nothing when the server declared neither, rather than inventing a bound", () => {
    expect(settingBoundsHint(declaredSetting("quota.ai.retired", { minimum: undefined, maximum: undefined }))).toBe("");
    // Half a range is not a range. A hint reading "Between 1m and undefined"
    // is worse than no hint, and the server refuses out-of-range writes either
    // way.
    expect(settingBoundsHint(declaredSetting("auth.lockout.duration", { minimum: "1m" }))).toBe("");
  });
});
