//! Create an agent, start a run, follow it live, then page through history.
//!
//! ```sh
//! UARP_API_KEY=uarp_... cargo run --example quickstart
//! ```

use std::pin::pin;

use futures_util::StreamExt;
use uarp_sdk::api::ListAgentsParams;
use uarp_sdk::models::{Agent, CreateAgentRequest, CreateRunRequest};
use uarp_sdk::{ApiErrorKind, Client, Error};

async fn create_agent(client: &Client) -> Result<Agent, Error> {
    let request = CreateAgentRequest {
        name: "quickstart".into(),
        ..Default::default()
    };
    client.agents().create(&request).await
}

async fn run_and_follow(client: &Client, agent_id: &str) -> Result<(), Error> {
    let run = client
        .runs()
        .create(&CreateRunRequest {
            agent_id: agent_id.to_string(),
            ..Default::default()
        })
        .await?;

    let runs = client.runs();
    let params = Default::default();
    // The stream reconnects with Last-Event-ID if the connection drops.
    let mut events = pin!(runs.stream_run_events(&run.run_id, &params));
    while let Some(event) = events.next().await {
        let event = event?;
        match event.event.as_str() {
            "llm.chunk" => print!("{}", event.data),
            "run.completed" | "run.failed" => break,
            _ => {}
        }
    }
    Ok(())
}

async fn list_everything(client: &Client) -> Result<(), Error> {
    let agents = client.agents();
    let params = ListAgentsParams {
        limit: Some(50),
        ..Default::default()
    };

    // `list_all` walks every page; `list` returns one page plus its cursor.
    let mut stream = pin!(agents.list_all(&params));
    while let Some(agent) = stream.next().await {
        let agent = agent?;
        println!("{}  {}", agent.agent_id, agent.name);
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    let client = match Client::from_env() {
        Ok(client) => client,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };

    if let Err(error) = async {
        let agent = create_agent(&client).await?;
        run_and_follow(&client, &agent.agent_id).await?;
        list_everything(&client).await
    }
    .await
    {
        match &error {
            Error::Api(api) if api.kind() == ApiErrorKind::UnprocessableEntity => {
                for failure in &api.problem.errors {
                    eprintln!(
                        "invalid {}: {}",
                        failure.field.as_deref().unwrap_or("?"),
                        failure.message.as_deref().unwrap_or("?")
                    );
                }
            }
            Error::Api(api) if api.kind() == ApiErrorKind::RateLimit => {
                eprintln!("rate limited; retry after {:?}s", api.retry_after_seconds());
            }
            other => eprintln!("{other}"),
        }
        std::process::exit(1);
    }
}
