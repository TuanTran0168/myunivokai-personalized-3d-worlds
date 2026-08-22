//! Opening the one connection every subscription shares.

use anyhow::Context;

use crate::config::Config;

const CLIENT_NAME: &str = "myunivokai-telemetry";

pub async fn connect(config: &Config) -> anyhow::Result<async_nats::Client> {
    // Credentials first: production authenticates to Synadia with a creds
    // file, and local development with a username and password. Neither is a
    // fallback for the other — a deployment that supplies both is
    // misconfigured, and the creds file is the one that wins because it is the
    // one a managed environment supplies deliberately.
    let options = if !config.nats_credentials_file.trim().is_empty() {
        // No `.into()` on the path: `&str` already satisfies `AsRef<Path>`,
        // and converting first leaves the target type ambiguous because a
        // transitive dependency adds its own `AsRef<Path>` impl to the
        // candidate set.
        async_nats::ConnectOptions::with_credentials_file(config.nats_credentials_file.trim())
            .await
            .context("read the NATS credentials file")?
    } else if !config.nats_username.trim().is_empty() {
        async_nats::ConnectOptions::with_user_and_password(
            config.nats_username.clone(),
            config.nats_password.clone(),
        )
    } else {
        async_nats::ConnectOptions::new()
    };

    options
        .name(CLIENT_NAME)
        .connection_timeout(config.nats_connect_timeout)
        // Reconnect forever rather than exiting, matching every other service.
        // On a scale-to-zero host a broker blip and a cold start look alike,
        // and a process that gives up needs a human where one that waits does
        // not.
        .max_reconnects(None)
        .connect(config.nats_url.clone())
        .await
        .context("connect to NATS")
}
