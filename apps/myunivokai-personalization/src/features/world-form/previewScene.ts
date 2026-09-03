import { buildPreviewSceneConfig, type PreviewSceneInput } from "@/lib/scene";
import { buildPreviewForestSceneConfig } from "@/lib/forestScene";
import { buildPreviewOceanSceneConfig } from "@/lib/oceanScene";
import type { SceneConfig, WorldFamily } from "@/lib/types";
import { buildCreateWorldPayload } from "./createWorldPayload";
import { isCreateFormPristine } from "./profileAutofill";
import type { CreateFormValues } from "./worldFormOptions";

export type PreviewSceneOptions = {
  /**
   * Show the ocean's calm sunlit surface instead of whatever depth its seed
   * rolls. Passed only while a form is still holding what it opened with —
   * see buildPreviewDepthConfig in oceanScene.ts for why only this family
   * needs the override.
   */
  showCalmSurfaceDefault?: boolean;
};

/**
 * The preview scene a family would render from these inputs.
 *
 * One function rather than an if-chain at each call site, because the choice
 * it makes is the one that was getting made wrong: a screen that reads the
 * family from one place and builds the scene from another shows the visitor a
 * universe while its own form says ocean. There are two call sites now — the
 * create page's live preview and the account page's backdrop — and both are
 * screens where the family is picked rather than known in advance.
 *
 * The world and share routes do NOT use this. They know their family for
 * certain and fetch the real scene the backend generated, rather than
 * mirroring it locally.
 */
export function buildPreviewSceneForFamily(
  family: WorldFamily,
  input: PreviewSceneInput,
  options: PreviewSceneOptions = {}
): SceneConfig {
  if (family === "nature") {
    return buildPreviewForestSceneConfig(input);
  }
  if (family === "ocean") {
    return buildPreviewOceanSceneConfig(input, { showCalmSurfaceDefault: options.showCalmSurfaceDefault });
  }
  return buildPreviewSceneConfig(input);
}

/**
 * The scene the create form would show if it opened, right now, holding these
 * values.
 *
 * The account page's backdrop is this and nothing else, which is the point:
 * choosing "Ocean" as a preferred family turns the world behind the profile
 * into an ocean, so the setting is answered by the thing it actually changes
 * rather than by a select that agrees with you and moves nothing.
 *
 * The create page does not use it. That page has two families in flight at
 * once during a transition — what the form says and what the canvas still
 * shows — and it debounces the payload rather than the values, so it composes
 * the same two functions itself with the lagging family.
 *
 * `isCreateFormPristine` decides the ocean's calm surface, and it ignores the
 * nickname deliberately: a name filled in from an account is not a choice
 * about the world.
 */
export function buildCreateFormPreviewScene(values: CreateFormValues): SceneConfig {
  return buildPreviewSceneForFamily(values.worldFamily, buildCreateWorldPayload(values), {
    showCalmSurfaceDefault: isCreateFormPristine(values)
  });
}
