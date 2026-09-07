import { describe, expect, it } from "vitest";
import {
  QUALITY_TIER_BALANCED,
  QUALITY_TIER_HIGH,
  QUALITY_TIER_MINIMAL,
  classifyDeviceQualityTier,
  renderProfileForTier,
  type DeviceRenderCapabilities
} from "./deviceQualityTier";

/**
 * The settings the canvas used before this story existed, written out here as
 * literals on purpose.
 *
 * This is the only assertion in the file that protects somebody who is not the
 * author: the story's fourth scenario says a tier-3 visitor's output must be
 * unchanged, and a test that derived these from the profile it is checking
 * would agree with itself no matter what the profile said.
 */
const SETTINGS_BEFORE_THIS_STORY = {
  devicePixelRatioRange: [1, 3] as [number, number],
  allowsShadows: true,
  postProcessing: { ambientOcclusion: true, bloom: true, lensAndGrain: true, vignette: true }
};

describe("the high tier is today's scene, unchanged", () => {
  it("matches the settings the canvas shipped before tiering existed", () => {
    const profile = renderProfileForTier(QUALITY_TIER_HIGH);
    expect(profile.devicePixelRatioRange).toEqual(SETTINGS_BEFORE_THIS_STORY.devicePixelRatioRange);
    expect(profile.allowsShadows).toBe(SETTINGS_BEFORE_THIS_STORY.allowsShadows);
    expect(profile.postProcessing).toEqual(SETTINGS_BEFORE_THIS_STORY.postProcessing);
  });

  // A device that answers none of the questions is the common case behind a
  // privacy extension, and it must not be treated as a weak one.
  it("is what an unrecognised device gets", () => {
    expect(classifyDeviceQualityTier({})).toBe(QUALITY_TIER_HIGH);
  });

  it("is what a device that answers only vaguely gets", () => {
    const capabilities: DeviceRenderCapabilities = { supportsWebGL2: true, logicalProcessorCount: 0 };
    expect(classifyDeviceQualityTier(capabilities)).toBe(QUALITY_TIER_HIGH);
  });
});

describe("classification", () => {
  const capableDesktop: DeviceRenderCapabilities = {
    isMobile: false,
    logicalProcessorCount: 16,
    deviceMemoryGigabytes: 8,
    supportsWebGL2: true,
    maximumTextureSize: 16384,
    rendererDescription: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)"
  };

  it("puts the machine this project is developed on at the top tier", () => {
    expect(classifyDeviceQualityTier(capableDesktop)).toBe(QUALITY_TIER_HIGH);
  });

  // The repo has measured what a software rasteriser does with these scenes:
  // roughly 1.5 frames a second under the Playwright suite's SwiftShader. No
  // profile rescues that, but it must not be handed the top one.
  it.each(["SwiftShader", "llvmpipe (LLVM 15.0.7, 256 bits)", "Microsoft Basic Render Driver"])(
    "sends a software rasteriser (%s) to the minimal tier however good the rest looks",
    (rendererDescription) => {
      expect(classifyDeviceQualityTier({ ...capableDesktop, rendererDescription })).toBe(QUALITY_TIER_MINIMAL);
    }
  );

  it("sends a device with no WebGL2 to the minimal tier", () => {
    expect(classifyDeviceQualityTier({ ...capableDesktop, supportsWebGL2: false })).toBe(QUALITY_TIER_MINIMAL);
  });

  // The universe family uploads 8192-wide textures. A GPU that cannot hold one
  // should not be asked to.
  it("sends a device that cannot hold the largest texture we upload to the minimal tier", () => {
    expect(classifyDeviceQualityTier({ ...capableDesktop, maximumTextureSize: 4096 })).toBe(QUALITY_TIER_MINIMAL);
  });

  it("sends a device short of cores or memory to the minimal tier", () => {
    expect(classifyDeviceQualityTier({ ...capableDesktop, logicalProcessorCount: 2 })).toBe(QUALITY_TIER_MINIMAL);
    expect(classifyDeviceQualityTier({ ...capableDesktop, deviceMemoryGigabytes: 2 })).toBe(QUALITY_TIER_MINIMAL);
  });

  // The story asks for distinct mobile and desktop thresholds, and this is the
  // case that shows they are distinct: identical numbers, different answers.
  it("holds a phone and a desktop with the same numbers to different tiers", () => {
    const numbers = { logicalProcessorCount: 8, deviceMemoryGigabytes: 8, supportsWebGL2: true, maximumTextureSize: 16384 };
    expect(classifyDeviceQualityTier({ ...numbers, isMobile: false })).toBe(QUALITY_TIER_HIGH);
    expect(classifyDeviceQualityTier({ ...numbers, isMobile: true })).toBe(QUALITY_TIER_BALANCED);
  });

  it("puts a modest desktop in the middle rather than at either end", () => {
    const modestDesktop: DeviceRenderCapabilities = { ...capableDesktop, logicalProcessorCount: 6 };
    expect(classifyDeviceQualityTier(modestDesktop)).toBe(QUALITY_TIER_BALANCED);
  });
});

describe("the visual-baseline suite keeps measuring what ships", () => {
  // The suite launches Chromium with --use-angle=swiftshader on purpose, so
  // without this guard every baseline image would start measuring the minimal
  // profile — a profile no visitor is ever served. This is the test that stops
  // somebody deleting the guard as a stray condition.
  const automatedSoftwareBrowser: DeviceRenderCapabilities = {
    isUnderAutomation: true,
    rendererDescription: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
    isMobile: false,
    logicalProcessorCount: 16,
    deviceMemoryGigabytes: 8,
    supportsWebGL2: true,
    maximumTextureSize: 16384
  };

  it("does not send an automated software-GL browser to the minimal tier", () => {
    expect(classifyDeviceQualityTier(automatedSoftwareBrowser)).toBe(QUALITY_TIER_HIGH);
  });

  // The guard is narrow on purpose: it excuses the RENDERER STRING and nothing
  // else. An automated browser that is genuinely short of cores is still weak.
  it("still applies every other signal under automation", () => {
    expect(classifyDeviceQualityTier({ ...automatedSoftwareBrowser, logicalProcessorCount: 2 })).toBe(
      QUALITY_TIER_MINIMAL
    );
    expect(classifyDeviceQualityTier({ ...automatedSoftwareBrowser, supportsWebGL2: false })).toBe(
      QUALITY_TIER_MINIMAL
    );
    expect(classifyDeviceQualityTier({ ...automatedSoftwareBrowser, isMobile: true })).toBe(QUALITY_TIER_BALANCED);
  });

  it("still sends a real visitor on software GL to the minimal tier", () => {
    expect(classifyDeviceQualityTier({ ...automatedSoftwareBrowser, isUnderAutomation: false })).toBe(
      QUALITY_TIER_MINIMAL
    );
  });
});

describe("the profiles only ever raise the floor", () => {
  const tiers = [QUALITY_TIER_MINIMAL, QUALITY_TIER_BALANCED, QUALITY_TIER_HIGH] as const;

  it("never lets a lower tier ask for more pixels than a higher one", () => {
    const ceilings = tiers.map((tier) => renderProfileForTier(tier).devicePixelRatioRange[1]);
    expect(ceilings).toEqual([...ceilings].sort((first, second) => first - second));
  });

  // Every tier's floor is the same, and it is the adaptive controller's floor
  // too: below a ratio of 1 the scene stops being the thing the product sells.
  it("never renders below one device pixel per CSS pixel", () => {
    for (const tier of tiers) {
      expect(renderProfileForTier(tier).devicePixelRatioRange[0]).toBe(1);
    }
  });

  it("never drops a postprocessing pass that a lower tier keeps", () => {
    const passes = ["ambientOcclusion", "bloom", "lensAndGrain", "vignette"] as const;
    for (const pass of passes) {
      const enabled = tiers.map((tier) => renderProfileForTier(tier).postProcessing[pass]);
      // Once a pass is on at some tier it must stay on at every higher one.
      expect(enabled).toEqual([...enabled].sort((first, second) => Number(first) - Number(second)));
    }
  });

  // The colour grade is the art direction rather than an effect, so it is not
  // in the profile at all — there is no flag here that could turn it off.
  it("has no switch that could disable the colour grade", () => {
    const profile = renderProfileForTier(QUALITY_TIER_MINIMAL);
    expect(Object.keys(profile.postProcessing).sort()).toEqual(
      ["ambientOcclusion", "bloom", "lensAndGrain", "vignette"].sort()
    );
  });
});
