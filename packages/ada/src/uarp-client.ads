--  The client: configuration, auth, retries, idempotency and error mapping.
--
--  Generated operations in ``UARP.API.*`` all funnel through ``Call`` and
--  ``Stream`` here.

with UARP.Errors;
with UARP.JSON_Support;
with UARP.SSE;
with UARP.Types;

package UARP.Client is

   use UARP.Types;

   subtype JSON_Value is UARP.JSON_Support.JSON_Value;

   --  Production base URL, from the OpenAPI document.
   Default_Base_URL : constant String := "https://api.snaga.ai";

   type Client_Type is tagged private;

   --  Build a client. ``Timeout_Ms`` of 0 means "no timeout".
   function Create
     (API_Key            : String;
      Base_URL           : String := Default_Base_URL;
      Timeout_Ms         : Natural := 60_000;
      Max_Retries        : Natural := 2;
      User_Agent_Suffix  : String := "";
      SSE_Token_In_Query : Boolean := False) return Client_Type;

   --  Read ``UARP_API_KEY`` (or ``SNAGA_API_KEY``) and ``UARP_BASE_URL`` from
   --  the environment. Raises ``UARP.Errors.Configuration_Error`` if unset.
   function From_Environment return Client_Type;

   function Base_URL (Self : Client_Type) return String;

   --  Connection-lifecycle states reported by ``Stream`` via ``On_State``.
   type Stream_State_Kind is
     (State_Connecting,   --  About to open (or reopen) the HTTP connection.
      State_Connected,    --  The server answered 200 and the stream is being read.
      State_Reconnecting, --  Waiting on backoff before a reconnect attempt.
      State_Disconnected); --  The stream ended without the caller aborting it.

   type Stream_State is record
      Kind    : Stream_State_Kind := State_Connecting;
      --  1-based attempt number; only meaningful when Kind = State_Reconnecting.
      Attempt : Natural := 0;
   end record;

   --  Optional connection-lifecycle observer.  ``Disconnected`` is NOT fired
   --  when the caller aborts the stream — only on a natural end.
   type State_Callback is access procedure (State : Stream_State);

   --  A set of event names that complete the stream WITHOUT reconnecting.
   --  Empty by default: a generic stream reconnects on end and lets the caller
   --  stop it.  The platform's run stream passes ``done``, ``run.completed``,
   --  ``run.failed``, ``team_run_done``.
   subtype Event_Name_Set is Text_Vectors.Vector;
   Empty_Event_Set : constant Event_Name_Set := Text_Vectors.Empty_Vector;

   --  Per-call overrides. ``Max_Retries`` of -1 keeps the client default.
   type Request_Options is record
      Timeout_Ms      : Natural := 0;
      Max_Retries     : Integer := -1;
      --  Reuse a specific key, e.g. to safely replay a create.
      Idempotency_Key : Text;
      Extra_Headers   : Pair_Vectors.Vector;
      Extra_Query     : Pair_Vectors.Vector;
      --  Event streams only; ignored by unary calls. A stream that ends is
      --  reopened with `Last-Event-ID`, and a connection that delivered at
      --  least one event resets the budget.
      Reconnect       : Boolean := True;
      Max_Reconnects  : Natural := 5;
      --  Event names that complete the stream WITHOUT reconnecting.
      Terminal_Events : Event_Name_Set := Empty_Event_Set;
      --  Max silence (in SECONDS — libcurl is seconds-granularity only) before
      --  the socket is presumed dead and a reconnect is attempted.  0 disables
      --  the watchdog (EOF owns liveness).
      Inactivity_Timeout_Seconds : Natural := 0;
      --  Base reconnect interval in ms; a `retry:` field overrides it per stream.
      Base_Retry_Millis : Positive := 2_000;
      --  Cap on the reconnect backoff.
      Max_Backoff_Millis : Positive := 8_000;
      --  Reconnect budget resets after this long connected without a disconnect.
      Stability_Reset_Millis : Positive := 60_000;
      --  Optional connection-lifecycle observer.
      On_State : State_Callback := null;
   end record;

   Default_Options : constant Request_Options;

   --  Issue a request and return the decoded JSON body.
   --
   --  Raises ``UARP.Errors.API_Error`` for a non-2xx status and
   --  ``UARP.Errors.Transport_Error`` when no response arrived.
   function Call
     (Self        : Client_Type;
      Method      : String;
      Path        : String;
      Query       : Pair_Vectors.Vector := No_Pairs;
      Headers     : Pair_Vectors.Vector := No_Pairs;
      Payload     : JSON_Value := UARP.JSON_Support.Null_Value;
      Has_Payload : Boolean := False;
      Idempotent  : Boolean := False;
      Options     : Request_Options := Default_Options) return JSON_Value;

   --  Same, discarding the response body. Named apart from the function so a
   --  call in a statement position is never ambiguous.
   procedure Call_And_Discard
     (Self        : Client_Type;
      Method      : String;
      Path        : String;
      Query       : Pair_Vectors.Vector := No_Pairs;
      Headers     : Pair_Vectors.Vector := No_Pairs;
      Payload     : JSON_Value := UARP.JSON_Support.Null_Value;
      Has_Payload : Boolean := False;
      Idempotent  : Boolean := False;
      Options     : Request_Options := Default_Options);

   --  Same, returning the body verbatim (file downloads, CSV exports).
   --  Each character of the result is one byte of the response.
   function Call_Raw
     (Self         : Client_Type;
      Method       : String;
      Path        : String;
      Query       : Pair_Vectors.Vector := No_Pairs;
      Headers     : Pair_Vectors.Vector := No_Pairs;
      Payload      : String := "";
      Has_Payload  : Boolean := False;
      Content_Type : String := "application/json";
      Idempotent   : Boolean := False;
      Options      : Request_Options := Default_Options) return Text;

   --  The non-raising entry point: reports the status and problem document
   --  instead of raising, for callers that want structured error handling.
   procedure Execute
     (Self        : Client_Type;
      Method      : String;
      Path        : String;
      Query       : Pair_Vectors.Vector := No_Pairs;
      Headers     : Pair_Vectors.Vector := No_Pairs;
      Payload     : String := "";
      Has_Payload : Boolean := False;
      Content_Type : String := "application/json";
      Idempotent   : Boolean := False;
      Options      : Request_Options := Default_Options;
      Status      : out Natural;
      Body_Text   : out Text;
      Problem     : out UARP.Errors.Problem);

   --  Open a server-sent event stream, dispatching every event to ``Sink``.
   --
   --  Returns when the sink asks to stop, when a terminal event or
   --  ``data: [DONE]`` arrives, or when the stream ends and the reconnect
   --  budget in ``Options`` is spent.
   --
   --  The sink may be a local variable and two tasks may stream at once; no
   --  state is shared between calls.
   procedure Stream
     (Self    : Client_Type;
      Path    : String;
      Sink    : in out UARP.SSE.Event_Sink'Class;
      Query   : Pair_Vectors.Vector := No_Pairs;
      Headers : Pair_Vectors.Vector := No_Pairs;
      Options : Request_Options := Default_Options);

   --  Parse a problem document out of a response body.
   function To_Problem (Body_Text : String) return UARP.Errors.Problem;

private

   type Client_Type is tagged record
      API_Key            : Text;
      Base                : Text;
      Timeout_Ms         : Natural := 60_000;
      Max_Retries         : Natural := 2;
      User_Agent          : Text;
      SSE_Token_In_Query  : Boolean := False;
   end record;

   Default_Options : constant Request_Options :=
     (Timeout_Ms      => 0,
      Max_Retries     => -1,
      Idempotency_Key => Empty_Text,
      Extra_Headers   => Pair_Vectors.Empty_Vector,
      Extra_Query     => Pair_Vectors.Empty_Vector,
      Reconnect       => True,
      Max_Reconnects  => 5,
      Terminal_Events => Empty_Event_Set,
      Inactivity_Timeout_Seconds => 0,
      Base_Retry_Millis => 2_000,
      Max_Backoff_Millis => 8_000,
      Stability_Reset_Millis => 60_000,
      On_State => null);

end UARP.Client;