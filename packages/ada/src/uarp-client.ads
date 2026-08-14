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
      Path         : String;
      Query        : Pair_Vectors.Vector := No_Pairs;
      Headers      : Pair_Vectors.Vector := No_Pairs;
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
      Idempotent  : Boolean := False;
      Options     : Request_Options := Default_Options;
      Status      : out Natural;
      Body_Text   : out Text;
      Problem     : out UARP.Errors.Problem);

   --  Open a server-sent event stream, dispatching every event to ``Sink``.
   --
   --  Returns when the sink asks to stop, or when the stream ends and the
   --  reconnect budget in ``Options`` is spent.
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
      Max_Reconnects  => 5);

end UARP.Client;
