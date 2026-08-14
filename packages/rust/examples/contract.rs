//! Contract runner for the Rust SDK.
//!
//! Performs the sequence in contract/SCENARIOS.md against the contract server.
//! It asserts nothing: the server records the traffic and run.sh compares it.
//!
//!   UARP_CONTRACT_BASE_URL=http://127.0.0.1:8940 cargo run --example contract

use std::pin::pin;

use futures_util::StreamExt;
use uarp_sdk::api::{ListAgentsParams, StreamRunEventsParams};
use uarp_sdk::models::{CreateAgentRequest, CreateRunRequest, RegistryPublishRequest};
use uarp_sdk::{Client, Error, FilePart};

/// A quote, a backslash, a newline, a tab, a non-ASCII letter and a character
/// outside the basic plane — everything a JSON encoder has to escape or carry.
const AWKWARD: &str = "\"q\" \\ \n \t ы 😀";

#[tokio::main]
async fn main() -> Result<(), Error> {
    let base = std::env::var("UARP_CONTRACT_BASE_URL").expect("UARP_CONTRACT_BASE_URL is not set");
    let client = Client::builder()
        .api_key("uarp_contract_secret")
        .base_url(base)
        .max_retries(2)
        .build()?;

    // 1. query serialisation
    let params = ListAgentsParams {
        limit: Some(2),
        ..Default::default()
    };
    client.agents().list(&params).await?;

    // 2. path encoding
    client.agents().get("id with/slash").await?;

    // 3. JSON body and the automatic idempotency key
    client
        .agents()
        .create(&CreateAgentRequest {
            name: "demo".into(),
            ..Default::default()
        })
        .await?;

    // 4. cursor paging, consumed to the end
    {
        let agents = client.agents();
        let all_params = ListAgentsParams::default();
        let mut all = pin!(agents.list_all(&all_params));
        while let Some(agent) = all.next().await {
            agent?;
        }
    }

    // 5. a 429 that is retried
    client.agents().get("retry-me").await?;

    // 6. a 404 that is not
    match client.agents().get("missing").await {
        Err(Error::Api(_)) => {}
        Err(other) => return Err(other),
        Ok(_) => panic!("expected a 404"),
    }

    // 7. an event stream, stopped by the caller
    {
        let runs = client.runs();
        let stream_params = StreamRunEventsParams::default();
        let mut events = pin!(runs.stream_run_events("r1", &stream_params));
        while let Some(event) = events.next().await {
            if event?.event == "run.completed" {
                break;
            }
        }
    }

    // 8. binary download
    client.files().download_file_content("f1").await?;

    // 9. no content
    client.files().delete("f1").await?;

    // 10. multipart upload
    client
        .registry()
        .registry_publish(&RegistryPublishRequest {
            manifest: "{\"name\":\"demo\"}".into(),
            artifact: FilePart::new("artifact", vec![0x00, 0xFF, 0x41]),
            sha256: Some("abc123".into()),
            ..Default::default()
        })
        .await?;

    // 11. query encoding, spaces and reserved characters included
    let odd = ListAgentsParams {
        workspace_id: Some("ы w&x=y+z*!()~".into()),
        ..Default::default()
    };
    client.agents().list(&odd).await?;

    // 12. a multibyte path segment
    client.agents().get("агент/ы").await?;

    // 13. a header parameter
    {
        let runs = client.runs();
        let resume = StreamRunEventsParams {
            last_event_id: Some("42".into()),
            ..Default::default()
        };
        let mut events = pin!(runs.stream_run_events("r1", &resume));
        while let Some(event) = events.next().await {
            if event?.event == "run.completed" {
                break;
            }
        }
    }

    // 14. zero and false must survive, not be dropped as falsy
    let falsy = ListAgentsParams {
        limit: Some(0),
        include_offline: Some(false),
        ..Default::default()
    };
    client.agents().list(&falsy).await?;

    // 15. JSON string escaping and a zero in a body
    client
        .runs()
        .create(&CreateRunRequest {
            agent_id: AWKWARD.to_string(),
            session_id: Some(String::new()),
            version: Some(0),
            ..Default::default()
        })
        .await?;

    // 16. how the decoder handles a payload built to strain it
    let probe = client.runs().get("probe").await?;
    let mut keys: Vec<String> = probe
        .metadata
        .as_ref()
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default();
    keys.sort();

    let probes = serde_json::json!({
        "status": probe.status.as_str(),
        "error_is_absent": probe.error.is_none().to_string(),
        "step_seq": probe.step_seq.map(|value| value.to_string()).unwrap_or_else(|| "absent".into()),
        "artifacts_count": probe
            .artifacts
            .as_ref()
            .map(|items| items.len().to_string())
            .unwrap_or_else(|| "absent".into()),
        "metadata_keys": keys.join(","),
        "metrics_output_tokens": probe
            .metrics
            .as_ref()
            .and_then(|m| m.output_tokens)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "absent".into()),
        "metrics_input_tokens": probe
            .metrics
            .as_ref()
            .and_then(|m| m.input_tokens)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "absent".into()),
        "started_at_is_absent": probe.started_at.is_none().to_string(),
    });

    let report = serde_json::json!({ "language": "rust", "probes": probes });
    let _: serde_json::Value = client
        .raw(reqwest::Method::POST, "/__report", Some(&report))
        .await?;

    println!("rust runner done");
    Ok(())
}
