//! Reading the environment, and refusing to guess when it is wrong.
//!
//! Mirrors every Go service's `internal/config`: a real process environment
//! always outranks a dotenv file, so a deployed container is never silently
//! repointed by a file that happened to be baked into the image. `dotenvy`'s
//! non-overriding loader gives that for free — it sets only variables that are
//! currently unset — where the Go services had to snapshot and restore the
//! environment by hand to get the same result.

use std::time::Duration;

pub fn load_environment_files() {
    if let Ok(explicit_file) = std::env::var("MYUNIVOKAI_ENV_FILE") {
        if !explicit_file.trim().is_empty() {
            let _ = dotenvy::from_filename(explicit_file.trim());
            return;
        }
    }
    let _ = dotenvy::from_filename(".env");
    let _ = dotenvy::from_filename(".env.local");
}

pub fn get(key: &str, fallback: &str) -> String {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_owned(),
        _ => fallback.to_owned(),
    }
}

/// An unparseable number is an error rather than a silent fallback, unlike the
/// Go services' `getInt`.
///
/// That is a deliberate divergence, not an oversight: `DATABASE_MAX_CONNS=1O`
/// with a letter O in it should stop a deploy, and silently running on the
/// default is exactly the kind of misconfiguration nobody finds until the
/// symptom is somewhere else entirely.
pub fn get_number<NumberType: std::str::FromStr>(
    key: &str,
    fallback: NumberType,
) -> Result<NumberType, String> {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => value
            .trim()
            .parse()
            .map_err(|_| format!("{key} must be a number, got {value:?}")),
        _ => Ok(fallback),
    }
}

/// Parses Go's duration spelling ("60s", "2m", "2500ms", "6h") so that one
/// `.env.example` and one `render.yaml` can describe every service in this
/// repository the same way, regardless of which language reads it.
pub fn get_duration(key: &str, fallback: Duration) -> Result<Duration, String> {
    let raw = match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_owned(),
        _ => return Ok(fallback),
    };
    parse_go_duration(&raw).ok_or_else(|| {
        format!("{key} must be a duration such as 500ms, 30s, 5m or 6h, got {raw:?}")
    })
}

fn parse_go_duration(raw: &str) -> Option<Duration> {
    let (digits, unit) = raw.split_at(raw.find(|character: char| character.is_alphabetic())?);
    let amount: u64 = digits.parse().ok()?;
    match unit {
        "ms" => Some(Duration::from_millis(amount)),
        "s" => Some(Duration::from_secs(amount)),
        "m" => Some(Duration::from_secs(amount * 60)),
        "h" => Some(Duration::from_secs(amount * 60 * 60)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn go_style_durations_are_understood() {
        // One `.env.example` and one `render.yaml` describe every service in
        // this repository the same way, regardless of which language reads it.
        assert_eq!(
            parse_go_duration("2500ms"),
            Some(Duration::from_millis(2500))
        );
        assert_eq!(parse_go_duration("30s"), Some(Duration::from_secs(30)));
        assert_eq!(parse_go_duration("2m"), Some(Duration::from_secs(120)));
        assert_eq!(parse_go_duration("6h"), Some(Duration::from_secs(21_600)));
        assert_eq!(parse_go_duration("later"), None);
        assert_eq!(parse_go_duration("30"), None);
    }
}
