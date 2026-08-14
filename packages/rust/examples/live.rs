//! Live runner for the Rust SDK.
//!
//! Performs smoke/live/SCENARIO.md against the real server and prints one JSON
//! object. It asserts almost nothing itself: compare.py decides whether the
//! five languages agree.
//!
//!   UARP_API_KEY=… cargo run --example live

use std::pin::pin;

use futures_util::StreamExt;
use serde_json::json;
use uarp_sdk::api::ListAgentsParams;
use uarp_sdk::models::{AgentModelConfig, AgentModelConfigProvider, CreateAgentRequest};
use uarp_sdk::{Client, Error};

const LANGUAGE: &str = "rust";
const MISSING_ID: &str = "00000000-0000-4000-8000-000000000000";

//  Reported in place of a value the SDK could not read. The wording is shared
//  by all five runners so that "both failed" compares equal; the reason goes to
//  stderr, where it does not affect the comparison.
const DECODE_FAILED: &str = "decode failed";

#[tokio::main]
async fn main() -> Result<(), Error> {
    let agent_name = format!("smoke-live-{LANGUAGE}");
    let client = Client::builder()
        .api_key(std::env::var("UARP_API_KEY").expect("UARP_API_KEY is not set"))
        .base_url(std::env::var("UARP_BASE_URL").unwrap_or_else(|_| "https://api.snaga.ai".into()))
        .max_retries(2)
        .build()?;

    let mut report = serde_json::Map::new();
    report.insert("language".into(), json!(LANGUAGE));

    // 1. public health, no authorisation needed
    report.insert("health".into(), json!(client.health().get().await?.status));

    // 2. the key resolves to an identity
    let me = client.auth().get_me().await?;
    report.insert("role".into(), json!(me.role));
    //  Serialising an enum to a JSON string cannot fail; the SDK's own error
    //  type has nothing to represent it with, so the value is unwrapped here.
    let auth_method = serde_json::to_value(&me.auth_method).unwrap_or(serde_json::Value::Null);
    report.insert("auth_method".into(), auth_method);

    // 3. a list with query parameters.
    //
    //    A decode failure is reported rather than raised: the whole point of
    //    running five SDKs against one server is to see which of them cannot
    //    read what it sends, and a panic here would hide that behind a stack
    //    trace instead of putting it in the comparison.
    let params = ListAgentsParams { limit: Some(2), ..Default::default() };
    match client.agents().list(&params).await {
        Ok(page) => {
            report.insert("page_size".into(), json!(page.items.len().min(2)));
        }
        Err(Error::Decode(error)) => {
            eprintln!("page_size: {error}");
            report.insert("page_size".into(), json!(DECODE_FAILED));
        }
        Err(other) => return Err(other),
    }

    // 4. a 404 that must arrive as a typed error carrying a problem document
    match client.agents().get(MISSING_ID).await {
        Err(Error::Api(error)) => {
            report.insert("not_found_status".into(), json!(error.status));
            report.insert(
                "problem_has_title".into(),
                json!(error.problem.title.as_deref().is_some_and(|title| !title.is_empty())),
            );
        }
        Err(other) => return Err(other),
        Ok(_) => {
            report.insert("not_found_status".into(), json!("no error"));
        }
    }

    // 5. a write, with the idempotency key the SDK attaches on its own
    let created = client
        .agents()
        .create(&CreateAgentRequest {
            name: agent_name.clone(),
            model: AgentModelConfig {
                provider: AgentModelConfigProvider::OpenaiCompat,
                model_ref: "gpt-4o-mini".into(),
                capabilities: Default::default(),
                ..Default::default()
            },
            ..Default::default()
        })
        .await;

    let created_id = match created {
        Ok(agent) => {
            report.insert("created".into(), json!(!agent.agent_id.is_empty()));
            Some(agent.agent_id)
        }
        Err(Error::Api(error)) => {
            report.insert("created".into(), json!(false));
            report.insert("create_error".into(), json!(error.status));
            None
        }
        Err(Error::Decode(error)) => {
            eprintln!("created: {error}");
            report.insert("created".into(), json!(DECODE_FAILED));
            None
        }
        Err(other) => return Err(other),
    };

    // 6. read it back, then 7. remove it again
    if let Some(id) = created_id {
        match client.agents().get(&id).await {
            Ok(fetched) => {
                report.insert("name_round_trips".into(), json!(fetched.name == agent_name));
            }
            Err(Error::Decode(error)) => {
                eprintln!("name_round_trips: {error}");
                report.insert("name_round_trips".into(), json!(DECODE_FAILED));
            }
            Err(other) => return Err(other),
        }

        match client.agents().delete(&id).await {
            Ok(_) => {
                report.insert("deleted".into(), json!(true));
            }
            Err(Error::Api(error)) => {
                report.insert("deleted".into(), json!(false));
                report.insert("delete_error".into(), json!(error.status));
            }
            Err(other) => return Err(other),
        }
    }

    // 8. cursor pagination, stopped by the caller after six items
    {
        let agents = client.agents();
        let all_params = ListAgentsParams { limit: Some(2), ..Default::default() };
        let mut all = pin!(agents.list_all(&all_params));
        let mut seen = 0usize;
        let mut decoded = true;
        while let Some(agent) = all.next().await {
            match agent {
                Ok(_) => seen += 1,
                Err(Error::Decode(_)) => {
                    decoded = false;
                    break;
                }
                Err(other) => return Err(other),
            }
            if seen >= 6 {
                break;
            }
        }
        report.insert(
            "paged_items".into(),
            if decoded { json!(seen) } else { json!(DECODE_FAILED) },
        );
    }

    println!("{}", serde_json::Value::Object(report));
    Ok(())
}
