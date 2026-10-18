"""Contract runner for the Python SDK.

Performs the sequence in ../SCENARIOS.md against the contract server. It
asserts nothing about traffic: the server records it and run.sh compares it.

    UARP_CONTRACT_BASE_URL=http://127.0.0.1:8940 python contract/runners/python.py
"""

import json
import os
import urllib.request

from uarp_sdk import APIError, Client
from uarp_sdk.models import (
    ApplyToJobRequest,
    CompleteOAuthLoginFormPostProvider,
    CompleteOAuthLoginFormPostRequest,
    CreateAgentRequest,
    CreateRunRequest,
    JobSeniority,
    RegistryPublishRequest,
)

base_url = os.environ.get("UARP_CONTRACT_BASE_URL")
if not base_url:
    raise SystemExit("UARP_CONTRACT_BASE_URL is not set")

client = Client(api_key="uarp_contract_secret", base_url=base_url, max_retries=2)

#  A quote, a backslash, a newline, a tab, a non-ASCII letter and a character
#  outside the basic plane — everything a JSON encoder has to escape or carry.
AWKWARD = '"q" \\ \n \t ы 😀'


def report(probes: dict) -> None:
    """Send what this SDK decoded, for the harness to compare across languages."""
    request = urllib.request.Request(
        f"{base_url}/__report",
        data=json.dumps({"language": "python", "probes": probes}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(request).read()


# 1. query serialisation
client.agents.list(limit=2)

# 2. path encoding
client.agents.get("id with/slash")

# 3. JSON body and the automatic idempotency key
client.agents.create(CreateAgentRequest(name="demo"))

# 4. cursor paging, consumed to the end
for _agent in client.agents.list_all():
    pass

# 5. a 429 that is retried
client.agents.get("retry-me")

# 6. a 404 that is not
refused = False
try:
    client.agents.get("missing")
except APIError:
    refused = True
#  A scenario that silently does not happen would make the traces agree for
#  the wrong reason.
if not refused:
    raise SystemExit("expected a 404")

# 7. an event stream, stopped by the caller
with client.runs.stream_run_events("r1") as events:
    for event in events:
        if event.event == "run.completed":
            break

# 8. binary download
client.files.download_file_content("f1")

# 9. no content
client.files.delete("f1")

# 10. multipart upload
client.registry.registry_publish(
    RegistryPublishRequest(manifest='{"name":"demo"}', artifact=bytes([0, 255, 65]), sha256="abc123")
)

# 11. query encoding, spaces and reserved characters included
client.agents.list(workspace_id="ы w&x=y+z*!()~")

# 12. a multibyte path segment
client.agents.get("агент/ы")

# 13. a header parameter
with client.runs.stream_run_events("r1", last_event_id="42") as events:
    for event in events:
        if event.event == "run.completed":
            break

# 14. zero and false must survive, not be dropped as falsy
client.agents.list(limit=0, include_offline=False)

# 15. JSON string escaping and a zero in a body
client.runs.create(CreateRunRequest(agent_id=AWKWARD, session_id="", version=0))

# 16. how the decoder handles a payload built to strain it
probe = client.runs.get("probe")

COMPLETION = {
    "model": "contract/model",
    "stream": True,
    "messages": [{"role": "user", "content": "hi"}],
}

# 17. a POST read as an event stream, consumed to `data: [DONE]`
post_stream_text = ""
for event in client.stream_post("/api/v1/llm/chat/completions", COMPLETION):
    post_stream_text += event.json()["choices"][0].get("delta", {}).get("content", "")

# 18. a refusal before the stream: the API error, and no retry even on 429
post_stream_refusal = "no error"
try:
    for _event in client.stream_post("/api/v1/llm/chat/completions/refused", COMPLETION):
        pass
except APIError as error:
    post_stream_refusal = f"{error.status} {error.problem.detail}"

# 19. a 2xx that is not an event stream: an error, not an empty stream
plain_events = 0
post_stream_plain = None
try:
    for _event in client.stream_post("/api/v1/llm/chat/completions/plain", COMPLETION):
        plain_events += 1
except APIError as error:
    post_stream_plain = f"error {error.status}"
if post_stream_plain is None:
    post_stream_plain = f"events {plain_events}"

# 20. a form body, compared byte for byte; fields in schema order
signed_in = client.auth.complete_o_auth_login_form_post(
    CompleteOAuthLoginFormPostProvider.APPLE,
    CompleteOAuthLoginFormPostRequest(code="c 1+2", state="s/ы&=~*", user='{"name":"А Б","email":"a@b.c"}'),
)

# 21. array query parameters: the key once per item, in declaration order
jobs = client.public.list_public_jobs(seniority=[JobSeniority.JUNIOR, JobSeniority.SENIOR], country=["UA"])

# 22. an array in a multipart body: one JSON array text part
applied = client.public.apply_to_job(
    "dev",
    ApplyToJobRequest(
        name="А Б",
        email="a@b.c",
        consent="true",
        links=["https://a.example/x?y=1", "https://b.example/"],
    ),
)

# One report: the server keeps the last one per language.
report(
    {
        "status": str(probe.status),
        "error_is_absent": "true" if probe.error is None else "false",
        "step_seq": str(probe.step_seq),
        "artifacts_count": "absent" if probe.artifacts is None else str(len(probe.artifacts)),
        "metadata_keys": ",".join(sorted((probe.metadata or {}).keys())),
        "metrics_output_tokens": "absent" if probe.metrics is None or probe.metrics.output_tokens is None
        else str(probe.metrics.output_tokens),
        "metrics_input_tokens": "absent" if probe.metrics is None or probe.metrics.input_tokens is None
        else str(probe.metrics.input_tokens),
        "started_at_is_absent": "true" if probe.started_at is None else "false",
        "post_stream_text": post_stream_text,
        "post_stream_refusal": post_stream_refusal,
        "post_stream_plain": post_stream_plain,
        "form_post_email": signed_in.email,
        "jobs_total": str(jobs.total),
        "application_id": applied.application.id,
    }
)

client.close()
print("python runner done")
