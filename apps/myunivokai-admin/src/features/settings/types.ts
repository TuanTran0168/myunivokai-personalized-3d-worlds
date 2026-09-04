// Mirrors contracts.SettingSummary and contracts.SettingType. The four types
// are the four the Go registry declares; the screen switches on this value to
// pick an input, so a type it has never seen has to render as something rather
// than as nothing — see settingInputKind.
export type SettingType = "string" | "int" | "bool" | "duration";

export interface SettingSummary {
  key: string;
  /** Absent on an orphan row — there is no declaration left to take it from. */
  type?: SettingType;
  description?: string;
  /** What the platform is using: the row if there is one, the default otherwise. */
  value: string;
  defaultValue?: string;
  isDeclared: boolean;
  /**
   * A row exists. Different from `value !== defaultValue`: a row that restates
   * the default is still somebody's decision and still shows who made it.
   */
  isOverridden: boolean;
  minimum?: string;
  maximum?: string;
  allowedValues?: string[];
  updatedByAccountId?: string;
  updatedAt?: string;
}

export interface SettingListResponse {
  settings: SettingSummary[];
}

// The number of leading key segments that name a group. `quota.ai.*` and
// `auth.token.*` become sections, which is what the dotted scheme was chosen
// for — the varying part comes last, so siblings sort together and a new
// setting needs no frontend change at all.
const GROUP_SEGMENT_COUNT = 2;

export const UNKNOWN_SETTINGS_GROUP_LABEL = "Unknown";

export interface SettingGroup {
  /** The dotted prefix, or UNKNOWN_SETTINGS_GROUP_LABEL for the orphans. */
  label: string;
  settings: SettingSummary[];
}

/**
 * Groups by key prefix, and puts every orphan in one group at the end
 * regardless of what its key looks like.
 *
 * The orphans are separated by DECLAREDNESS rather than by prefix on purpose.
 * An orphan's key still parses — it was a declared key once — so grouping it
 * by prefix would file a setting nothing can validate in among the ones that
 * can, where it reads as editable.
 *
 * Declared groups keep the order the registry returned them in, which is the
 * order the Go declaration lists them; a sorted-by-name pass here would
 * silently override a deliberate ordering.
 */
export function groupSettings(settings: SettingSummary[]): SettingGroup[] {
  const groups: SettingGroup[] = [];
  const groupsByLabel = new Map<string, SettingGroup>();

  function groupFor(label: string): SettingGroup {
    const existing = groupsByLabel.get(label);
    if (existing) return existing;
    const created: SettingGroup = { label, settings: [] };
    groupsByLabel.set(label, created);
    groups.push(created);
    return created;
  }

  for (const setting of settings) {
    if (!setting.isDeclared) continue;
    groupFor(settingGroupLabel(setting.key)).settings.push(setting);
  }
  const orphans = settings.filter((setting) => !setting.isDeclared);
  if (orphans.length > 0) {
    groupFor(UNKNOWN_SETTINGS_GROUP_LABEL).settings.push(...orphans);
  }
  return groups;
}

/**
 * The first two segments of a key, or the whole key when it has fewer. A key
 * with one segment is not something the Go pattern forbids, so the label falls
 * back to the key rather than to an empty heading.
 */
export function settingGroupLabel(key: string): string {
  const segments = key.split(".");
  if (segments.length <= GROUP_SEGMENT_COUNT) return key;
  return segments.slice(0, GROUP_SEGMENT_COUNT).join(".");
}

/** The last segment, which is the part that varies within a group. */
export function settingLeafLabel(key: string): string {
  const segments = key.split(".");
  return segments[segments.length - 1] ?? key;
}

export type SettingInputKind = "number" | "boolean" | "choice" | "text";

/**
 * Which control renders a setting.
 *
 * A `string` setting with a closed vocabulary gets a select and one without
 * gets a free text field — the registry's `allowedValues` is what decides,
 * so adding a choice setting needs no change here. An unrecognised type falls
 * back to text rather than to nothing: an operator who can see a value must be
 * able to correct it, and the server validates whatever is sent anyway.
 */
export function settingInputKind(setting: SettingSummary): SettingInputKind {
  switch (setting.type) {
    case "int":
      return "number";
    case "bool":
      return "boolean";
    case "string":
      return setting.allowedValues && setting.allowedValues.length > 0 ? "choice" : "text";
    default:
      return "text";
  }
}

/**
 * The hint under an input: the range, or the vocabulary, or nothing.
 *
 * Bounds come from the server because they are declared in Go — the one place
 * they can be, since they are what makes exposing a security-relevant number
 * to a web form safe. This screen states them and never enforces them.
 */
export function settingBoundsHint(setting: SettingSummary): string {
  if (setting.allowedValues && setting.allowedValues.length > 0) {
    return `One of ${setting.allowedValues.join(", ")}`;
  }
  if (setting.minimum && setting.maximum) {
    return `Between ${setting.minimum} and ${setting.maximum}`;
  }
  return "";
}
