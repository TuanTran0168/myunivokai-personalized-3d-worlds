const AMBIENT_SOUND_PREFERENCE_STORAGE_KEY = "myunivokai.ambientSoundEnabled";
const AMBIENT_SOUND_ENABLED_VALUE = "true";
const AMBIENT_SOUND_DISABLED_VALUE = "false";

// Ambience is ON by default. Only an explicit mute is stored, so "no stored
// value" means a first-time visitor who should get the sound.
//
// This does NOT make the page autoplay, and it cannot: a browser refuses to
// emit audio before the visitor has interacted with the document. What the
// default buys is that nobody has to find the toggle — the hook arms the first
// gesture (which on a world page is the first orbit-drag or key press) and the
// ambience comes up from there. See useAmbientSoundscape.
const DEFAULT_AMBIENT_SOUND_ENABLED = true;

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined";
}

export function readAmbientSoundPreference(): boolean {
  if (!isBrowserEnvironment()) {
    return DEFAULT_AMBIENT_SOUND_ENABLED;
  }
  try {
    const storedValue = window.localStorage.getItem(AMBIENT_SOUND_PREFERENCE_STORAGE_KEY);
    if (storedValue === AMBIENT_SOUND_DISABLED_VALUE) {
      return false;
    }
    if (storedValue === AMBIENT_SOUND_ENABLED_VALUE) {
      return true;
    }
    return DEFAULT_AMBIENT_SOUND_ENABLED;
  } catch {
    // Storage may be unavailable (private mode, quota).
    return DEFAULT_AMBIENT_SOUND_ENABLED;
  }
}

export function writeAmbientSoundPreference(isEnabled: boolean): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  try {
    // A mute is written explicitly rather than removed: removing the key would
    // read back as the default, which is on, and the mute would not survive.
    window.localStorage.setItem(
      AMBIENT_SOUND_PREFERENCE_STORAGE_KEY,
      isEnabled ? AMBIENT_SOUND_ENABLED_VALUE : AMBIENT_SOUND_DISABLED_VALUE
    );
  } catch {
    // Preference is best-effort; failing to persist must not break playback.
  }
}
