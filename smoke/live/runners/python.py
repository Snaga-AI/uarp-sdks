"""Live runner for the Python SDK.

Performs smoke/live/SCENARIO.md against the real server and prints one JSON
object. It asserts almost nothing itself: compare.py decides whether the
languages agree.

    UARP_API_KEY=… python smoke/live/runners/python.py
"""

import json
import os
import sys
from typing import Any, Dict, Optional

from uarp_sdk import APIError, Client, DecodeError
from uarp_sdk.models import CreateAgentRequest

if not os.environ.get("UARP_API_KEY"):
    raise SystemExit("UARP_API_KEY is not set")

client = Client(base_url=os.environ.get("UARP_BASE_URL", "https://api.snaga.ai"), max_retries=2)

LANGUAGE = "python"
AGENT_NAME = f"smoke-live-{LANGUAGE}"
MISSING_ID = "00000000-0000-4000-8000-000000000000"

#  Reported in place of a value the SDK could not read. The wording is shared
#  by every runner so that "both failed" compares equal; the reason goes to
#  stderr, where it does not affect the comparison.
DECODE_FAILED = "decode failed"

report: Dict[str, Any] = {"language": LANGUAGE}

# 1. public health, no authorisation needed
report["health"] = str(client.health.get().status)

# 2. the key resolves to an identity
me = client.auth.get_me()
report["role"] = me.role
report["auth_method"] = str(me.auth_method)

# 3. a list with query parameters. A decode failure is reported rather than
#    raised: the point of running every SDK against one server is to see
#    which of them cannot read what it sends.
try:
    report["page_size"] = min(len(client.agents.list(limit=2).items), 2)
except DecodeError as error:
    print("page_size:", error, file=sys.stderr)
    report["page_size"] = DECODE_FAILED

# 4. a 404 that must arrive as a typed error carrying a problem document
try:
    client.agents.get(MISSING_ID)
    report["not_found_status"] = "no error"
except APIError as error:
    report["not_found_status"] = error.status
    report["problem_has_title"] = bool(error.problem.title)

# 5. a write, with the idempotency key the SDK attaches on its own
created_id: Optional[str] = None
try:
    created_id = client.agents.create(CreateAgentRequest(name=AGENT_NAME)).agent_id
    report["created"] = bool(created_id)
except (APIError, DecodeError) as error:
    report["created"] = False
    report["create_error"] = error.status if isinstance(error, APIError) else str(error)

# 6. read it back
if created_id:
    try:
        report["name_round_trips"] = client.agents.get(created_id).name == AGENT_NAME
    except DecodeError as error:
        print("name_round_trips:", error, file=sys.stderr)
        report["name_round_trips"] = DECODE_FAILED

# 7. and remove it again
if created_id:
    try:
        client.agents.delete(created_id)
        report["deleted"] = True
    except (APIError, DecodeError) as error:
        report["deleted"] = False
        report["delete_error"] = error.status if isinstance(error, APIError) else str(error)

# 8. cursor pagination, stopped by the caller after six items
seen = 0
try:
    for _agent in client.agents.list_all(limit=2):
        seen += 1
        if seen >= 6:
            break
    report["paged_items"] = seen
except DecodeError as error:
    print("paged_items:", error, file=sys.stderr)
    report["paged_items"] = DECODE_FAILED

client.close()
print(json.dumps(report))
