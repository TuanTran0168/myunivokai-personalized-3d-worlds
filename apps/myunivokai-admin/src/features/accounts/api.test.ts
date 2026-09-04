import { afterEach, describe, expect, it, vi } from "vitest";
import { accountsApi } from "./api";
import { ACCOUNT_KIND_FILTER_OPTIONS, ALL_ACCOUNT_KINDS, accountKindLabel } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

function stubFetchAndCaptureUrl(): { requestedUrls: string[] } {
  const requestedUrls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ accounts: [] })
      } as unknown as Response;
    })
  );
  return { requestedUrls };
}

describe("the account list's kind filter", () => {
  // The sentinel exists for the select control, which needs a real value for
  // its trigger to have a label. It must never reach the gateway: `kind=all`
  // is a value auth-service would put into a SQL equality predicate, and the
  // gateway maps an unrecognised kind to no filter - so sending it would
  // happen to work today and break the moment either side got stricter.
  it("sends no kind parameter for 'all accounts'", async () => {
    const { requestedUrls } = stubFetchAndCaptureUrl();

    await accountsApi.list("", ALL_ACCOUNT_KINDS);

    expect(requestedUrls[0]).toBe("/api/admin/accounts");
  });

  it("sends the kind for a specific one, alongside the search", async () => {
    const { requestedUrls } = stubFetchAndCaptureUrl();

    await accountsApi.list("visitor", "end_user");

    expect(requestedUrls[0]).toBe("/api/admin/accounts?q=visitor&kind=end_user");
  });

  // Filtering happens in auth-service, which is why the parameter goes on the
  // URL at all: this list is cursor-paginated, so filtering the page the
  // client received would report "no end users" whenever the newest twenty
  // accounts were staff.
  it("keeps the cursor alongside the filter, so paging a filtered list works", async () => {
    const { requestedUrls } = stubFetchAndCaptureUrl();

    await accountsApi.list("", "staff", "a-cursor");

    expect(requestedUrls[0]).toContain("kind=staff");
    expect(requestedUrls[0]).toContain("cursor=a-cursor");
  });
});

describe("the labels staff read", () => {
  // `kind` is a database value and `aud=web` names a token's channel. Neither
  // is what a staff member is looking for on this screen, and the plan freezes
  // both names in the contracts precisely so the displayed words can be chosen
  // separately.
  it("names the two kinds in words rather than in schema values", () => {
    expect(accountKindLabel("staff")).toBe("Staff");
    expect(accountKindLabel("end_user")).toBe("End user");
  });

  it("offers every kind plus an unfiltered option, and nothing else", () => {
    expect(ACCOUNT_KIND_FILTER_OPTIONS.map((option) => option.value)).toEqual([ALL_ACCOUNT_KINDS, "staff", "end_user"]);
  });
});
