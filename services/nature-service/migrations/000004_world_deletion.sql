-- +goose Up
-- Deletion is a flag, and the flag is a timestamp: "when" costs exactly what
-- "whether" costs, and it is the difference between a deletion that can be
-- reversed and one that can be reversed knowingly.
--
-- The row is never physically removed (decision 4), and the SCOPE of the flag
-- is the product surface only. This service filters flagged rows out of the
-- world read, the batch read and share resolution, so a caller holding the raw
-- UUID and no browser gets nothing either — a frontend hiding a card it was
-- handed is not a deletion, because the data is still on the wire.
--
-- Staff analytics is deliberately untouched (decision 4b). Its allow list holds
-- no `owner_account_id`, so it has nothing personal to hide, and a total that
-- shrank whenever somebody deleted a world would stop being historically true.
--
-- Nullable with no default, so ADD COLUMN stays metadata-only on an
-- already-deployed table.
-- See agent-system/plans/architecture/end-user-identity-and-ownership.md#world-deletion-by-its-owner-is-a-feature-and-it-is-a-flag.
ALTER TABLE worlds ADD COLUMN deleted_at TIMESTAMPTZ;

-- No index, on purpose. Every read this filter is added to already locates its
-- row by primary key or by the unique share slug, so `deleted_at IS NULL` is a
-- recheck on a row that has been found rather than a way of finding one. An
-- index here would serve no query this platform runs.

-- +goose Down
ALTER TABLE worlds DROP COLUMN IF EXISTS deleted_at;
