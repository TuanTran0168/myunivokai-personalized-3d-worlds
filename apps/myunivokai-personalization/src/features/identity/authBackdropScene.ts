import { buildPreviewSceneConfig } from "@/lib/scene";
import type { SceneConfig } from "@/lib/types";
import type { PreviewSceneInput } from "@/lib/scene";
import type { AuthCredentialsFormMode } from "./authCredentialsFormState";

/**
 * The world behind the two credential screens.
 *
 * These pages used to be a card on a flat black page, which made them the only
 * two screens in the app with nothing alive on them — the first two screens a
 * new visitor sees, promising a 3D universe. The backdrop is built the way the
 * gallery's is: a fixed set of inputs through the same preview builder the
 * create form uses, so nothing here is a second scene format.
 *
 * The two modes get DIFFERENT worlds, and that is the point rather than a
 * flourish. Sign-up is somebody's first look, so it is the wide, bright,
 * many-planet one. Sign-in is a return, so it is calmer, cooler and slower —
 * the two screens are one route apart and an identical backdrop would make
 * moving between them feel like nothing happened.
 *
 * Neither offers ambient sound. The gallery's backdrop does, because a gallery
 * is somewhere you linger; a sign-in screen is somewhere you are trying to
 * leave, and sound on it is an obstacle with a volume control.
 */
export const AUTH_BACKDROP_INPUTS: Record<AuthCredentialsFormMode, PreviewSceneInput> = {
  // Both moods and both styles are values the universe family actually
  // declares (UNIVERSE_MOOD_OPTIONS / UNIVERSE_STYLE_OPTIONS). moodSceneProfile
  // falls back to a neutral profile for anything it does not know, so an
  // invented mood here would not fail — it would quietly render the same scene
  // twice, which is the failure that is hard to notice.
  "sign-up": {
    nickname: "Myunivokai",
    interests: ["Space", "Design", "Music", "Science", "Art"],
    traits: ["curious", "creative", "builder"],
    mood: "dreamy",
    preferredWorldStyle: "nebula",
    favoriteColors: ["#C9A35B", "#7C5CF0", "#6FB3C9"]
  },
  "sign-in": {
    nickname: "Myunivokai",
    interests: ["Space", "Philosophy", "Music"],
    traits: ["calm", "focused"],
    mood: "reflective",
    preferredWorldStyle: "cosmic-galaxy",
    favoriteColors: ["#6FB3C9", "#2E4A6B", "#C9A35B"]
  }
};

/**
 * The scene for one mode. Deterministic: the preview builder seeds itself from
 * these inputs, so a given screen shows the same world on every visit rather
 * than a different one each time somebody mistypes a password.
 */
export function authBackdropSceneFor(mode: AuthCredentialsFormMode): SceneConfig {
  return buildPreviewSceneConfig(AUTH_BACKDROP_INPUTS[mode]);
}
