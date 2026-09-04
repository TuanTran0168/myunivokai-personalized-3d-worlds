package services

import (
	"context"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// S8-IDENTITY-006's server side: staff can find end-user accounts, which they
// could not before because nothing in the platform could create one.
//
// The filter is server-side and this test is why. The list is cursor
// paginated, so a client-side filter would filter the page it happened to
// receive — and report "there are no end users" whenever the newest twenty
// accounts were all staff. The assertion below is deliberately built on a set
// where that failure would show: several staff accounts created after the
// end-user one.
func TestListAccounts_FiltersByKindAcrossThePageBoundary(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	endUserSession := signUpTestEndUser(t, authService, "visitor@example.com")
	// Created after the end user, so they sort ahead of it (newest first) and
	// would fill a small page on their own.
	for _, staffEmail := range []string{"one@example.com", "two@example.com", "three@example.com"} {
		createTestAccount(t, authService, store, staffEmail, testEndUserPassword)
	}

	const pageSizeSmallerThanTheStaffCount = 2

	endUsers, err := authService.ListAccounts(context.Background(), "", pageSizeSmallerThanTheStaffCount, "", contracts.AccountKindEndUser)
	if err != nil {
		t.Fatalf("list end-user accounts: %v", err)
	}
	if len(endUsers.Accounts) != 1 {
		t.Fatalf("end-user page holds %d accounts, want the 1 that exists - a filter applied after pagination would have returned none", len(endUsers.Accounts))
	}
	if endUsers.Accounts[0].AccountID != endUserSession.Account.AccountID {
		t.Fatalf("listed %q, want the end-user account", endUsers.Accounts[0].Email)
	}

	staff, err := authService.ListAccounts(context.Background(), "", pageSizeSmallerThanTheStaffCount, "", contracts.AccountKindStaff)
	if err != nil {
		t.Fatalf("list staff accounts: %v", err)
	}
	for _, account := range staff.Accounts {
		if account.Kind != contracts.AccountKindStaff {
			t.Fatalf("the staff filter returned a %q account", account.Kind)
		}
	}
	// The page is full and a cursor came back, which is what proves the filter
	// ran against the whole set rather than one page of it.
	if len(staff.Accounts) != pageSizeSmallerThanTheStaffCount || staff.NextCursor == "" {
		t.Fatalf("staff page = %d accounts with cursor %q, want a full page and a cursor", len(staff.Accounts), staff.NextCursor)
	}
}

// An empty kind means every kind, so the filter is additive: the admin app's
// existing unfiltered request keeps working unchanged.
func TestListAccounts_WithNoKindReturnsBoth(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	signUpTestEndUser(t, authService, "visitor@example.com")
	createTestAccount(t, authService, store, "staff@example.com", testEndUserPassword)

	listed, err := authService.ListAccounts(context.Background(), "", 20, "", "")
	if err != nil {
		t.Fatalf("list accounts: %v", err)
	}

	kindsSeen := map[contracts.AccountKind]bool{}
	for _, account := range listed.Accounts {
		kindsSeen[account.Kind] = true
	}
	if !kindsSeen[contracts.AccountKindStaff] || !kindsSeen[contracts.AccountKindEndUser] {
		t.Fatalf("an unfiltered list returned only %v", kindsSeen)
	}
}

// Search and kind have to compose, or "find this person's account" needs the
// staff member to know which kind it is before they can look for it.
func TestListAccounts_ComposesSearchWithTheKindFilter(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	signUpTestEndUser(t, authService, "shared-name@example.com")
	createTestAccount(t, authService, store, "shared-name-staff@example.com", testEndUserPassword)

	listed, err := authService.ListAccounts(context.Background(), "", 20, "shared-name", contracts.AccountKindEndUser)
	if err != nil {
		t.Fatalf("list accounts: %v", err)
	}
	if len(listed.Accounts) != 1 || listed.Accounts[0].Email != "shared-name@example.com" {
		t.Fatalf("search plus kind returned %d accounts (%+v), want only the end-user one", len(listed.Accounts), listed.Accounts)
	}
}
