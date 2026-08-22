//! The query window, as a type rather than an `i64` nobody remembers to clamp.
//!
//! This is the API guidelines' C-NEWTYPE applied to the one number in this
//! service that is dangerous when unbounded: a window is used directly in a
//! `WHERE bucket_start >= $1` against a minute-resolution table, so an
//! unclamped 100000 is a query that outlives its own request/reply deadline.
//!
//! Making it a type moves "did anyone clamp this?" from a review question to a
//! compile-time one - a repository that takes a [`QueryWindow`] cannot be
//! handed a raw hour count by accident.

use myunivokai_contracts::normalize_telemetry_hours;
use time::OffsetDateTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueryWindow {
    hours: i64,
}

impl QueryWindow {
    /// Clamps rather than rejects, deliberately.
    ///
    /// This backs a dashboard control, and a range input that answers 400
    /// teaches an operator to leave it alone. The bound itself lives in the
    /// contract so the gateway, this service and the admin app cannot disagree
    /// about what the maximum is.
    pub fn from_hours(requested: i64) -> Self {
        Self {
            hours: normalize_telemetry_hours(requested),
        }
    }

    pub fn hours(self) -> i64 {
        self.hours
    }

    /// The instant the window opens.
    ///
    /// `now` is a parameter rather than a call to the system clock, which is
    /// what makes every test below deterministic and what keeps the domain
    /// layer free of I/O. Only the outermost caller reads a clock.
    pub fn since(self, now: OffsetDateTime) -> OffsetDateTime {
        now - self.duration()
    }

    pub fn duration(self) -> time::Duration {
        time::Duration::hours(self.hours)
    }

    /// The window of the same width immediately before this one, as the
    /// half-open interval `[start, end)` a comparison reads.
    ///
    /// The end is this window's own start, not one instant before it: the two
    /// intervals must partition the timeline so that a bucket sitting exactly
    /// on the boundary is counted once. Returning the pair from here rather
    /// than doing the subtraction at the call site is what keeps that rule in
    /// one place — the repository is handed boundaries, never asked to invent
    /// them.
    pub fn previous(self, now: OffsetDateTime) -> (OffsetDateTime, OffsetDateTime) {
        let start_of_this_window = self.since(now);
        (start_of_this_window - self.duration(), start_of_this_window)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn an_absent_or_nonsense_window_becomes_the_default() {
        assert_eq!(QueryWindow::from_hours(0).hours(), 24);
        assert_eq!(QueryWindow::from_hours(-3).hours(), 24);
    }

    // The maximum matches MYUNIVOKAI_EVENTS's own 7-day retention: asking for
    // more is a question the stream could never have answered.
    #[test]
    fn a_window_longer_than_the_stream_retains_is_clamped() {
        assert_eq!(QueryWindow::from_hours(9999).hours(), 168);
        assert_eq!(QueryWindow::from_hours(168).hours(), 168);
    }

    #[test]
    fn the_window_opens_exactly_its_own_length_before_now() {
        let now = datetime!(2026-08-13 12:00:00 UTC);
        assert_eq!(
            QueryWindow::from_hours(6).since(now),
            datetime!(2026-08-13 06:00:00 UTC)
        );
    }

    // The two intervals have to meet exactly. A gap loses buckets from the
    // comparison; an overlap counts them twice and makes every "vs previous"
    // reading optimistic.
    #[test]
    fn the_previous_window_abuts_this_one_with_no_gap_and_no_overlap() {
        let now = datetime!(2026-08-13 12:00:00 UTC);
        let window = QueryWindow::from_hours(6);
        let (previous_start, previous_end) = window.previous(now);
        assert_eq!(previous_start, datetime!(2026-08-13 00:00:00 UTC));
        assert_eq!(previous_end, window.since(now));
        assert_eq!(previous_end - previous_start, window.duration());
    }
}
