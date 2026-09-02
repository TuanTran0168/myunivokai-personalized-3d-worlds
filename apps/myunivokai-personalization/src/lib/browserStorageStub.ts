/**
 * A cookie jar and a `localStorage` good enough to test `productSession.ts`
 * against, in the `node` vitest environment this app already uses.
 *
 * Not `.test.ts` because more than one test file needs it, and not a switch to
 * `jsdom` because that would change the environment for every existing test in
 * `lib/` to buy two globals — and jsdom's own cookie handling is a third
 * implementation to reason about when what is under test is this app's own
 * parsing.
 *
 * The jar implements the part of `document.cookie` that `productSession.ts`
 * actually depends on, and no more: assignment adds or replaces one entry,
 * reading returns `name=value` pairs joined by "; ", and `Max-Age=0` removes.
 * That last one is not a detail — deletion in this app IS a zero max-age
 * write, so a stub that ignored it would make `clearProductSession` look like
 * it worked.
 */

type CookieJar = Map<string, string>;

export type BrowserStorageStub = {
  cookieJar: CookieJar;
  restore: () => void;
};

const MAXIMUM_AGE_ATTRIBUTE = "max-age";

function parseMaximumAge(attributes: string[]): number | null {
  for (const attribute of attributes) {
    const [name, value] = attribute.split("=");
    if (name.trim().toLowerCase() === MAXIMUM_AGE_ATTRIBUTE) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function createMemoryLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value)
  } as Storage;
}

/**
 * Installs the stubs and returns a `restore` the caller must run in
 * `afterEach`. Returning the jar as well lets a test assert on what was
 * written without going back through the reader under test, which would let a
 * matched pair of bugs cancel out.
 */
export function installBrowserStorageStub(protocol: "http:" | "https:" = "http:"): BrowserStorageStub {
  const cookieJar: CookieJar = new Map();
  const globalObject = globalThis as Record<string, unknown>;
  const originalDocument = globalObject.document;
  const originalWindow = globalObject.window;

  const documentStub = {
    get cookie(): string {
      return Array.from(cookieJar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
    set cookie(assignment: string) {
      const [pair, ...attributes] = assignment.split(";");
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex < 0) {
        return;
      }
      const name = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1);
      if (parseMaximumAge(attributes) === 0) {
        cookieJar.delete(name);
        return;
      }
      cookieJar.set(name, value);
    }
  };

  const windowStub = {
    location: { protocol },
    localStorage: createMemoryLocalStorage()
  };

  globalObject.document = documentStub;
  globalObject.window = windowStub;

  return {
    cookieJar,
    restore: () => {
      if (originalDocument === undefined) {
        delete globalObject.document;
      } else {
        globalObject.document = originalDocument;
      }
      if (originalWindow === undefined) {
        delete globalObject.window;
      } else {
        globalObject.window = originalWindow;
      }
    }
  };
}
