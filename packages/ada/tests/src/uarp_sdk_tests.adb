--  Test suite for the UARP Ada SDK.
--
--  Unit tests always run. The HTTP tests run only when UARP_TEST_BASE_URL
--  points at the mock server in tests/mock_server.py, so the suite stays
--  useful offline.

with Ada.Calendar;
with Ada.Command_Line;
with Ada.Directories;
with Ada.Environment_Variables;
with Ada.Exceptions;
with Ada.Streams.Stream_IO;
with Ada.Strings.Fixed;
with Ada.Text_IO;

with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.SSE;
with UARP.Types;

with UARP.API.Agents;
with UARP.API.Registry;
with UARP.Models;

with Stream_Collector;

procedure UARP_SDK_Tests is

   use UARP.Types;
   package IO renames Ada.Text_IO;
   package JS renames UARP.JSON_Support;

   Passed : Natural := 0;
   Failed : Natural := 0;

   procedure Check (Name : String; Condition : Boolean; Detail : String := "");
   procedure Check_Equal (Name : String; Actual, Expected : String);

   procedure Check (Name : String; Condition : Boolean; Detail : String := "") is
   begin
      if Condition then
         Passed := Passed + 1;
         IO.Put_Line ("  ok   " & Name);
      else
         Failed := Failed + 1;
         IO.Put_Line ("  FAIL " & Name & (if Detail'Length > 0 then " - " & Detail else ""));
      end if;
   end Check;

   procedure Check_Equal (Name : String; Actual, Expected : String) is
   begin
      Check (Name, Actual = Expected, "expected """ & Expected & """, got """ & Actual & """");
   end Check_Equal;

   --  Records the connection-lifecycle states a stream reports via On_State,
   --  as a string of one-letter codes in arrival order (C=Connecting,
   --  c=Connected, R=Reconnecting, D=Disconnected).  A string encodes both the
   --  count and the order, and avoids needing a container of Stream_State
   --  (whose predefined equality is not directly visible here).
   Recorded_Sequence : Text := Empty_Text;

   procedure Record_State (S : UARP.Client.Stream_State);
   procedure Record_State (S : UARP.Client.Stream_State) is
   begin
      case S.Kind is
         when UARP.Client.State_Connecting   =>
            Recorded_Sequence := +(+Recorded_Sequence & "C");
         when UARP.Client.State_Connected    =>
            Recorded_Sequence := +(+Recorded_Sequence & "c");
         when UARP.Client.State_Reconnecting =>
            Recorded_Sequence := +(+Recorded_Sequence & "R");
         when UARP.Client.State_Disconnected =>
            Recorded_Sequence := +(+Recorded_Sequence & "D");
      end case;
   end Record_State;

   --  Resolve the shared SSE fixture directory.  run-tests.sh exports
   --  UARP_SSE_FIXTURE_DIR; otherwise fall back to the paths that work when the
   --  test runs from packages/ada or packages/ada/tests.
   function Fixture_Dir return String is
     ((if Ada.Environment_Variables.Exists ("UARP_SSE_FIXTURE_DIR")
       then Ada.Environment_Variables.Value ("UARP_SSE_FIXTURE_DIR")
       elsif Ada.Directories.Exists ("../../contract/sse-fixtures/mixed.txt")
       then "../../contract/sse-fixtures"
       elsif Ada.Directories.Exists ("../../../contract/sse-fixtures/mixed.txt")
       then "../../../contract/sse-fixtures"
       else "contract/sse-fixtures"));

   function Read_File (Path : String) return String;

   function Read_File (Path : String) return String is
      use Ada.Streams.Stream_IO;
      use type Ada.Streams.Stream_Element_Offset;
      File   : File_Type;
      Size   : constant Ada.Streams.Stream_Element_Offset :=
        Ada.Streams.Stream_Element_Offset (Ada.Directories.Size (Path));
      Buffer : Ada.Streams.Stream_Element_Array (1 .. Size);
      Last   : Ada.Streams.Stream_Element_Offset;
   begin
      Open (File, In_File, Path);
      Read (File, Buffer, Last);
      Close (File);
      --  Each stream element is one byte; map straight onto a String so the
      --  decoder sees the exact bytes (no Text_IO line-ending translation).
      declare
         Result : String (1 .. Natural (Last));
      begin
         for I in 1 .. Natural (Last) loop
            Result (I) := Character'Val (Buffer (Ada.Streams.Stream_Element_Offset (I)));
         end loop;
         return Result;
      end;
   end Read_File;

   ----------------------
   -- URL and encoding --
   ----------------------

   --  "\u0430\u0433" in UTF-8, spelled out so the source stays pure ASCII.
   Cyrillic_AG : constant String :=
     (Character'Val (16#D0#), Character'Val (16#B0#),
      Character'Val (16#D0#), Character'Val (16#B3#));

   procedure Test_Encoding is
   begin
      IO.Put_Line ("encoding");
      Check_Equal ("unreserved characters pass through",
                   Encode_Path_Segment ("plain-id_1.2~3"), "plain-id_1.2~3");
      Check_Equal ("slashes and spaces are escaped",
                   Encode_Path_Segment ("id with/slash"), "id%20with%2Fslash");
      Check_Equal ("multibyte characters are escaped",
                   Encode_Path_Segment (Cyrillic_AG), "%D0%B0%D0%B3");
      Check_Equal ("query values are form-encoded",
                   Encode_Query ("a b&c"), "a%20b%26c");
      Check_Equal ("base and path join with one slash",
                   Join_URL ("https://api.test/", "/api/v1/agents"),
                   "https://api.test/api/v1/agents");

      declare
         Parameters : Pair_Vectors.Vector;
      begin
         Check_Equal ("an empty query renders nothing", Build_Query (Parameters), "");
         Add (Parameters, "limit", Integer_Value'(25));
         Add (Parameters, "cursor", "a b");
         Check_Equal ("query parameters are joined",
                      Build_Query (Parameters), "?limit=25&cursor=a%20b");
      end;
   end Test_Encoding;

   ---------------------
   -- The SSE decoder --
   ---------------------

   procedure Test_SSE is
      Parser : UARP.SSE.Parser;
      Events : UARP.SSE.Event_Vectors.Vector;
   begin
      IO.Put_Line ("sse");
      UARP.SSE.Feed (Parser, "event: run.started" & ASCII.LF, Events);
      Check ("an unterminated frame yields nothing yet", Events.Is_Empty);

      UARP.SSE.Feed (Parser, "data: {""run_id"":""r1""}" & ASCII.LF & ASCII.LF, Events);
      Check ("a blank line completes the frame", Natural (Events.Length) = 1);
      if not Events.Is_Empty then
         Check_Equal ("the event name is decoded", +Events.First_Element.Name, "run.started");
         Check_Equal ("the payload is decoded",
                      +Events.First_Element.Data, "{""run_id"":""r1""}");
      end if;

      Events.Clear;
      UARP.SSE.Feed (Parser, "data: one" & ASCII.LF & "data: two" & ASCII.LF & ASCII.LF, Events);
      Check ("multi-line data is joined", Natural (Events.Length) = 1);
      if not Events.Is_Empty then
         Check_Equal ("the default event name is message",
                      +Events.First_Element.Name, "message");
         Check_Equal ("data lines are newline-joined",
                      +Events.First_Element.Data, "one" & ASCII.LF & "two");
      end if;

      Events.Clear;
      UARP.SSE.Feed (Parser, ": keep-alive" & ASCII.LF & "foo: bar" & ASCII.LF, Events);
      UARP.SSE.Feed (Parser, "id: 42" & ASCII.LF & "data: x" & ASCII.LF & ASCII.LF, Events);
      Check ("comments and unknown fields are ignored", Natural (Events.Length) = 1);
      if not Events.Is_Empty then
         Check_Equal ("the id field is kept", +Events.First_Element.Id, "42");
         Check_Equal ("only the data field is payload", +Events.First_Element.Data, "x");
      end if;

      Events.Clear;
      UARP.SSE.Feed (Parser, "data: split" & ASCII.CR & ASCII.LF & ASCII.CR & ASCII.LF, Events);
      Check ("CRLF terminators are handled", Natural (Events.Length) = 1);
      if not Events.Is_Empty then
         Check_Equal ("the CR is stripped", +Events.First_Element.Data, "split");
      end if;
   end Test_SSE;

   --  The shared mixed-format fixture is locked by the Kotlin reference parser
   --  (mixed.expected.json).  Every SDK replays the same bytes and must match.
   --  This is the real proof of decoder parity: a parser that dropped comments,
   --  bare NDJSON, or `data: [DONE]` (the stock SDK decoder) would diverge here.
   --  Runs without the mock server — it exercises the pure decoder.
   procedure Test_SSE_Decode_Parity is
      Parser   : UARP.SSE.Parser;
      Events   : UARP.SSE.Event_Vectors.Vector;
      Last_E   : UARP.SSE.Server_Event;
      Has_Last : Boolean;
      Expected : constant JS.JSON_Array :=
        JS.JSON.Get (JS.Parse (Read_File (Fixture_Dir & "/mixed.expected.json")));
   begin
      IO.Put_Line ("sse decode parity");
      UARP.SSE.Feed (Parser, Read_File (Fixture_Dir & "/mixed.txt"), Events);
      UARP.SSE.Finish (Parser, Last_E, Has_Last);
      if Has_Last then
         Events.Append (Last_E);
      end if;

      Check ("the fixture decodes to the locked event count",
             Natural (Events.Length) = JS.JSON.Length (Expected),
             "got" & Natural'Image (Natural (Events.Length))
             & " expected" & Natural'Image (JS.JSON.Length (Expected)));

      for I in 1 .. Natural'Min (Natural (Events.Length), JS.JSON.Length (Expected)) loop
         declare
            Ev  : constant UARP.SSE.Server_Event := Events (Positive (I));
            Ex  : constant JS.JSON_Value := JS.JSON.Get (Expected, Positive (I));
            Tag : constant String :=
              "event[" & Ada.Strings.Fixed.Trim (Integer'Image (I), Ada.Strings.Both) & "]";
         begin
            Check (Tag & ".id matches",
                   Ev.Has_Id = JS.Present (Ex, "id")
                   and then (if Ev.Has_Id then +Ev.Id = +JS.Get_Text (Ex, "id") else True));
            Check_Equal (Tag & ".event", +Ev.Name, +JS.Get_Text (Ex, "event"));
            Check_Equal (Tag & ".data", +Ev.Data, +JS.Get_Text (Ex, "data"));
            Check (Tag & ".retry matches",
                   Ev.Has_Retry = JS.Present (Ex, "retry")
                   and then (if Ev.Has_Retry
                             then Ev.Retry_Ms = Natural (JS.Get_Integer (Ex, "retry"))
                             else True));
         end;
      end loop;

      Check ("data: [DONE] was recognised", UARP.SSE.Is_Done (Parser));
   end Test_SSE_Decode_Parity;

   ----------------------------
   -- JSON helper robustness --
   ----------------------------

   procedure Test_JSON is
      Document : constant JS.JSON_Value :=
        JS.Parse ("{""a"":1,""b"":""text"",""c"":null,""d"":[1,2],""e"":true}");
   begin
      IO.Put_Line ("json");
      Check ("a present field is reported present", JS.Present (Document, "a"));
      Check ("a null field is reported absent", not JS.Present (Document, "c"));
      Check ("a missing field is reported absent", not JS.Present (Document, "zz"));
      Check ("integers decode", JS.Get_Integer (Document, "a") = 1);
      Check_Equal ("strings decode", +JS.Get_Text (Document, "b"), "text");
      Check ("booleans decode", JS.Get_Boolean (Document, "e"));
      Check ("arrays decode", JS.JSON.Length (JS.Get_Array (Document, "d")) = 2);
      Check ("a missing integer defaults to zero", JS.Get_Integer (Document, "zz") = 0);
      Check ("a missing array defaults to empty",
             JS.JSON.Length (JS.Get_Array (Document, "zz")) = 0);

      declare
         Round_Trip : constant JS.JSON_Value := JS.New_Object;
         Reparsed   : JS.JSON_Value;
      begin
         JS.Set (Round_Trip, "name", String'("demo"));
         JS.Set (Round_Trip, "count", Integer_Value'(3));
         --  GNATCOLL does not promise a field order, so compare by round trip.
         Reparsed := JS.Parse (JS.Serialize (Round_Trip));
         Check_Equal ("string fields round-trip", +JS.Get_Text (Reparsed, "name"), "demo");
         Check ("integer fields round-trip", JS.Get_Integer (Reparsed, "count") = 3);
      end;

      begin
         declare
            Bad : constant JS.JSON_Value := JS.Parse ("{oops");
         begin
            Check ("malformed JSON raises", False, JS.Serialize (Bad));
         end;
      exception
         when UARP.Errors.Decoding_Error =>
            Check ("malformed JSON raises Decoding_Error", True);
      end;
   end Test_JSON;

   ------------------------
   -- Errors and problem --
   ------------------------

   procedure Test_Errors is
      use UARP.Errors;
      Item : constant Problem :=
        UARP.Client.To_Problem
          ("{""type"":""about:blank"",""title"":""Not Found"",""status"":404,"
           & """detail"":""no such agent"",""correlationId"":""corr-1""}");
   begin
      IO.Put_Line ("errors");
      Check_Equal ("the title is parsed", +Item.Title, "Not Found");
      Check_Equal ("the detail is parsed", +Item.Detail, "no such agent");
      Check_Equal ("the correlation id is parsed", +Item.Correlation_Id, "corr-1");
      Check ("404 classifies as Not_Found", Classify (404) = Not_Found);
      Check ("429 classifies as Rate_Limit", Classify (429) = Rate_Limit);
      Check ("500 classifies as a server error", Classify (500) = Server_Error);
      Check ("503 classifies as unavailable", Classify (503) = Service_Unavailable);
      Check ("429 is retryable", Is_Retryable (429));
      Check ("404 is not retryable", not Is_Retryable (404));
      Check (" the rendered message carries the detail",
             Ada.Strings.Fixed.Index (Image (Item, 404), "no such agent") > 0);

      declare
         Non_JSON : constant Problem := UARP.Client.To_Problem ("upstream exploded");
      begin
         Check_Equal ("a non-JSON body is preserved verbatim",
                      +Non_JSON.Raw, "upstream exploded");
      end;
   end Test_Errors;

   -----------------------
   -- Client validation --
   -----------------------

   procedure Test_Client_Configuration is
   begin
      IO.Put_Line ("client configuration");
      begin
         declare
            Ignored : constant UARP.Client.Client_Type := UARP.Client.Create ("");
         begin
            Check ("an empty API key is rejected", False, UARP.Client.Base_URL (Ignored));
         end;
      exception
         when UARP.Errors.Configuration_Error =>
            Check ("an empty API key raises Configuration_Error", True);
      end;

      declare
         Client : constant UARP.Client.Client_Type :=
           UARP.Client.Create ("uarp_test_secret", "https://api.example.test");
      begin
         Check_Equal ("the base URL is kept",
                      UARP.Client.Base_URL (Client), "https://api.example.test");
      end;
   end Test_Client_Configuration;

   -------------------
   -- HTTP round trip --
   -------------------

   --  The generated surface, exercised through the Agents package.
   procedure Test_Generated (Client : UARP.Client.Client_Type) is
      use type UARP.Models.Agent_Execution_Mode_Kind;
      Params : UARP.API.Agents.List_Agents_Params;
   begin
      declare
         Agent : constant UARP.Models.Agent := UARP.API.Agents.Get (Client, "a1");
      begin
         Check_Equal ("a generated getter decodes the model", +Agent.Agent_Id, "a1");
         Check ("nested records decode", Agent.Model.Has_Capabilities);
         Check ("known enum values map to a kind",
                Agent.Execution_Mode.Kind = UARP.Models.Agent_Execution_Mode_Worker);
         Check_Equal ("enum text is preserved",
                      UARP.Models.Image (Agent.Execution_Mode), "worker");
      end;

      Params.Has_Limit := True;
      Params.Limit := 1;
      declare
         Page : constant UARP.Models.List_Agents_Response :=
           UARP.API.Agents.List (Client, Params);
      begin
         Check ("a page decodes its items", Natural (Page.Items.Length) = 1);
         Check ("the cursor is reported", Page.Has_Cursor);
      end;

      declare
         Stuck   : UARP.Client.Request_Options;
         Looping : UARP.Models.Agent_Vectors.Vector;
      begin
         Add (Stuck.Extra_Query, "stuck", "1");
         Looping := UARP.API.Agents.List_All (Client, Params, Options => Stuck);
         --  Two pages, then the repeated cursor stops the walk.
         Check ("List_All stops when a server repeats a cursor",
                Natural (Looping.Length) = 2,
                Natural'Image (Natural (Looping.Length)));
      end;

      declare
         Everything : constant UARP.Models.Agent_Vectors.Vector :=
           UARP.API.Agents.List_All (Client, Params);
      begin
         Check ("List_All follows the cursor", Natural (Everything.Length) = 2,
                Natural'Image (Natural (Everything.Length)));
         if Natural (Everything.Length) = 2 then
            Check_Equal ("pages arrive in order",
                         (+Everything.First_Element.Agent_Id) & "," & (+Everything.Last_Element.Agent_Id),
                         "a1,a2");
         end if;
      end;

      declare
         Request : UARP.Models.Create_Agent_Request;
         Created : UARP.Models.Agent;
      begin
         --  The platform picks the model itself and ignores anything sent for
         --  it, so a create is just a name.
         Request.Name := +"demo";
         Created := UARP.API.Agents.Create (Client, Request);
         Check_Equal ("a generated create round-trips", +Created.Agent_Id, "a1");
      end;
   end Test_Generated;

   --  Two streams at once, each with its own sink. Before the sink interface
   --  the parser lived in a package variable and this test could not pass.
   procedure Test_Concurrent_Streams (Client : UARP.Client.Client_Type) is
      use type Ada.Calendar.Time;

      First  : Stream_Collector.Collector;
      Second : Stream_Collector.Collector;
      Started : constant Ada.Calendar.Time := Ada.Calendar.Clock;
      Elapsed : Duration;
   begin
      --  The tasks are declared in an inner block, so leaving it waits for both.
      declare
         task Reader_A;
         task Reader_B;

         task body Reader_A is
            Query : Pair_Vectors.Vector;
         begin
            Add (Query, "tag", "alpha");
            UARP.Client.Stream (Client, "/events", First, Query => Query);
         end Reader_A;

         task body Reader_B is
            Query : Pair_Vectors.Vector;
         begin
            Add (Query, "tag", "beta");
            UARP.Client.Stream (Client, "/events", Second, Query => Query);
         end Reader_B;
      begin
         null;
      end;

      Elapsed := Ada.Calendar.Clock - Started;

      Check_Equal ("a concurrent stream sees only its own events",
                   First.Names, "alpha.chunk,run.completed");
      Check_Equal ("the other concurrent stream sees only its own events",
                   Second.Names, "beta.chunk,run.completed");
      --  The mock holds each stream open for 0.2 s. Running them one after the
      --  other would take at least 0.4 s, so this is what proves they overlap.
      Check ("the two streams really ran at the same time", Elapsed < 0.35,
             "elapsed" & Duration'Image (Elapsed));
   end Test_Concurrent_Streams;

   --  Clients behind a proxy that strips Authorization can send the key as a
   --  query parameter instead.
   procedure Test_SSE_Token (Base : String) is
      Tokenised : constant UARP.Client.Client_Type :=
        UARP.Client.Create
          ("uarp_secret", Base, Timeout_Ms => 5_000, SSE_Token_In_Query => True);
      Plain : constant UARP.Client.Client_Type :=
        UARP.Client.Create ("uarp_secret", Base, Timeout_Ms => 5_000);

      With_Token    : Stream_Collector.Collector;
      Without_Token : Stream_Collector.Collector;
   begin
      UARP.Client.Stream (Tokenised, "/events/token", With_Token);
      Check_Equal ("the key travels in the query when asked",
                   With_Token.Names, "token.uarp_secret,run.completed");

      UARP.Client.Stream (Plain, "/events/token", Without_Token);
      Check_Equal ("and stays out of the URL otherwise",
                   Without_Token.Names, "token.absent,run.completed");
   end Test_SSE_Token;

   --  Reads always retry; writes only when the server can deduplicate them.
   procedure Test_Idempotency (Client : UARP.Client.Client_Type) is
      Options : UARP.Client.Request_Options;
      Echo    : JS.JSON_Value;
   begin
      Options.Idempotency_Key := +"order-4711";
      Echo := UARP.Client.Call
        (Client, "POST", "/echo",
         Payload => JS.New_Object, Has_Payload => True,
         Idempotent => True, Options => Options);
      Check_Equal ("a caller-supplied idempotency key is used",
                   +JS.Get_Text (Echo, "idempotency_key"), "order-4711");

      --  A write with no key must not be replayed: the server cannot tell a
      --  retry from a second request.
      declare
         Attempts : Natural;
         Before   : constant JS.JSON_Value := UARP.Client.Call (Client, "GET", "/flaky/count");
      begin
         Attempts := Natural (JS.Get_Integer (Before, "attempts"));
         begin
            declare
               Ignored : constant JS.JSON_Value :=
                 UARP.Client.Call (Client, "POST", "/flaky/write", Idempotent => False);
            begin
               Check ("a keyless write is not retried", False, JS.Serialize (Ignored));
            end;
         exception
            when UARP.Errors.API_Error =>
               declare
                  After : constant JS.JSON_Value :=
                    UARP.Client.Call (Client, "GET", "/flaky/count");
               begin
                  Check ("a keyless write is attempted exactly once",
                         Natural (JS.Get_Integer (After, "attempts")) = Attempts + 1,
                         Integer_Value'Image (JS.Get_Integer (After, "attempts")));
               end;
         end;
      end;
   end Test_Idempotency;

   --  A value the API adds later must round-trip rather than fail.
   procedure Test_Unknown_Enum is
      use type UARP.Models.Get_Me_Response_Auth_Method_Kind;

      Later : constant UARP.Models.Get_Me_Response_Auth_Method :=
        UARP.Models.To_Get_Me_Response_Auth_Method ("brand_new");
      Known : constant UARP.Models.Get_Me_Response_Auth_Method :=
        UARP.Models.To_Get_Me_Response_Auth_Method ("api_key");
   begin
      Check ("an unknown enum value is kept",
             Later.Kind = UARP.Models.Get_Me_Response_Auth_Method_Unrecognized);
      Check_Equal ("its text survives", UARP.Models.Image (Later), "brand_new");
      Check ("a known value still maps to its kind",
             Known.Kind = UARP.Models.Get_Me_Response_Auth_Method_API_Key);
      Check_Equal ("a kind renders its wire text",
                   UARP.Models.Image (Known), "api_key");
   end Test_Unknown_Enum;

   --  A 429 carries its retry and rate-limit hints in headers, not in the body,
   --  so the non-raising path has to surface them.
   procedure Test_Rate_Limit_Hints (Client : UARP.Client.Client_Type) is
      use type UARP.Errors.Error_Kind;

      Status    : Natural;
      Body_Text : Text;
      Problem   : UARP.Errors.Problem;
      Options   : UARP.Client.Request_Options;
   begin
      --  Without this the transport would retry the 429 away.
      Options.Max_Retries := 0;
      UARP.Client.Execute
        (Client, "GET", "/status/429", Options => Options,
         Status => Status, Body_Text => Body_Text, Problem => Problem);

      Check ("a 429 is classified as a rate limit",
             UARP.Errors.Classify (Status) = UARP.Errors.Rate_Limit);
      Check ("Retry-After reaches the caller",
             UARP.Errors.Retry_After_Seconds (Problem) = 1.5,
             Duration'Image (UARP.Errors.Retry_After_Seconds (Problem)));
      Check ("the remaining budget reaches the caller",
             UARP.Errors.Rate_Limit_Remaining (Problem) = 0,
             Integer'Image (UARP.Errors.Rate_Limit_Remaining (Problem)));
      Check ("the reset time reaches the caller",
             UARP.Errors.Rate_Limit_Reset (Problem) = 1767225600,
             Integer'Image (UARP.Errors.Rate_Limit_Reset (Problem)));

      declare
         Missing : UARP.Errors.Problem;
      begin
         Check ("an absent hint reads as -1",
                UARP.Errors.Rate_Limit_Remaining (Missing) = -1);
         Check ("an absent Retry-After reads as -1.0",
                UARP.Errors.Retry_After_Seconds (Missing) = -1.0);
      end;
   end Test_Rate_Limit_Hints;

   --  A stream that ends is reopened, replaying the last id it saw.
   procedure Test_Reconnect (Client : UARP.Client.Client_Type) is
      Events  : Stream_Collector.Collector;
      Options : UARP.Client.Request_Options;
   begin
      --  The budget only bounds *unproductive* reconnects; this stream ends
      --  because the sink stops on run.completed.
      Options.Max_Reconnects := 1;
      UARP.Client.Stream (Client, "/events/resume", Events, Options => Options);

      Check_Equal ("the stream reopens and replays the last id",
                   Events.Names, "first,resumed.7,run.completed");
   end Test_Reconnect;

   --  Reconnection can be switched off for a stream that should end once.
   procedure Test_No_Reconnect (Client : UARP.Client.Client_Type) is
      Events  : Stream_Collector.Collector;
      Options : UARP.Client.Request_Options;
   begin
      Options.Reconnect := False;
      UARP.Client.Stream (Client, "/events/resume", Events, Options => Options);

      Check_Equal ("reconnection can be turned off", Events.Names, "first");
   end Test_No_Reconnect;

   --  A terminal event completes the stream WITHOUT reconnecting.  The mock
   --  emits more data after the terminal event; an All_Collector never stops on
   --  its own, so the only way `after` is absent is the terminal-event handling.
   procedure Test_Terminal_Event_Stops (Client : UARP.Client.Client_Type) is
      Events  : Stream_Collector.All_Collector;
      Options : UARP.Client.Request_Options;
   begin
      Options.Terminal_Events.Append (+"run.completed");
      UARP.Client.Stream (Client, "/events/terminal", Events, Options => Options);

      Check_Equal ("a terminal event stops the stream without reconnect",
                   Stream_Collector.All_Names (Events), "chunk,run.completed");
   end Test_Terminal_Event_Stops;

   --  `data: [DONE]` is a hard terminal: no reconnect, and [DONE] itself is
   --  not a deliverable event.
   procedure Test_Done_Frame_Stops (Client : UARP.Client.Client_Type) is
      Events : Stream_Collector.All_Collector;
   begin
      --  Default options: Reconnect = True, no terminal set.  Only [DONE] ends it.
      UARP.Client.Stream (Client, "/events/done", Events);

      Check_Equal ("a DONE frame stops the stream without reconnect",
                   Stream_Collector.All_Names (Events), "chunk");
   end Test_Done_Frame_Stops;

   --  The inactivity watchdog reconnects a socket that went silent (held open
   --  with no further bytes) rather than treating the silence as a clean EOF.
   --  The reconnect replays the last delivered id as `Last-Event-ID`, which the
   --  mock echoes back in the event name.  libcurl is seconds-granularity, so
   --  the watchdog window is 1 s (the test takes just over a second).
   procedure Test_Watchdog_Reconnects_Silent_Socket
     (Client : UARP.Client.Client_Type) is
      Events  : Stream_Collector.All_Collector;
      Options : UARP.Client.Request_Options;
   begin
      Options.Inactivity_Timeout_Seconds := 1;
      Options.Base_Retry_Millis := 10;
      Options.Max_Backoff_Millis := 20;
      Options.Terminal_Events.Append (+"run.completed");
      UARP.Client.Stream (Client, "/events/silent", Events, Options => Options);

      Check_Equal ("the watchdog reconnects a silent socket with Last-Event-ID",
                   Stream_Collector.All_Names (Events), "llm.chunk,resumed.1,run.completed");
   end Test_Watchdog_Reconnects_Silent_Socket;

   --  A 401 always surfaces and is never retried, even with Reconnect on.
   procedure Test_401_Surfaces_Without_Retry (Client : UARP.Client.Client_Type) is
      Events : Stream_Collector.All_Collector;
   begin
      begin
         UARP.Client.Stream (Client, "/events/401", Events);
         Check ("a 401 stream surfaces API_Error", False, "no exception raised");
      exception
         when UARP.Errors.API_Error =>
            Check ("a 401 stream surfaces API_Error", True);
      end;

      --  The mock counts 401 hits; exactly one proves there was no retry.
      declare
         Count : constant JS.JSON_Value :=
           UARP.Client.Call (Client, "GET", "/events/401/count");
      begin
         Check ("a 401 stream is attempted exactly once",
                JS.Get_Integer (Count, "n") = Integer_Value'(1),
                "got" & Integer_Value'Image (JS.Get_Integer (Count, "n")));
      end;
   end Test_401_Surfaces_Without_Retry;

   --  On_State reports Connecting -> Connected -> Disconnected on a stream that
   --  ends on a terminal event (a terminal end is a natural end, not a cancel).
   procedure Test_Reports_Lifecycle_Via_On_State
     (Client : UARP.Client.Client_Type) is
      Events  : Stream_Collector.All_Collector;
      Options : UARP.Client.Request_Options;
   begin
      Recorded_Sequence := Empty_Text;
      Options.Terminal_Events.Append (+"run.completed");
      --  Record_State is local to this main subprogram; Stream runs it
      --  synchronously before returning, so the unrestricted access is safe.
      Options.On_State := Record_State'Unrestricted_Access;
      UARP.Client.Stream (Client, "/events/terminal", Events, Options => Options);

      Check_Equal ("On_State reported Connecting -> Connected -> Disconnected",
                   +Recorded_Sequence, "CcD");
   end Test_Reports_Lifecycle_Via_On_State;

   --  The multipart body is assembled by hand in UARP.Multipart, so this walks
   --  it all the way to a server that parses it back apart.
   procedure Test_Multipart (Client : UARP.Client.Client_Type) is
      Request : UARP.Models.Registry_Publish_Request;
   begin
      Request.Manifest := +"{""name"":""demo""}";
      --  A NUL and a high byte, to prove the body is not treated as C text.
      Request.Artifact :=
        +("bundle" & Character'Val (0) & Character'Val (16#FF#) & "tail");
      Request.Has_Sha256 := True;
      Request.Sha256 := +"abc123";

      declare
         Echo : constant UARP.Models.Registry_Publish_Response :=
           UARP.API.Registry.Registry_Publish (Client, Request);
      begin
         Check_Equal ("multipart text fields arrive intact",
                      +Echo.Scope, "{""name"":""demo""}");
         Check_Equal ("an optional part is included when set", +Echo.Sha256, "abc123");
         --  Echoed as hex: JSON cannot carry the raw bytes back.
         Check_Equal ("the file part keeps its bytes",
                      +Echo.Name, "62756e646c6500ff7461696c");
         Check ("the file part reports its real length", Echo.Size_Bytes = 12,
                Integer_Value'Image (Echo.Size_Bytes));
         Check ("the file part carries a filename", +Echo.Version /= "no-filename");
      end;
   end Test_Multipart;

   --  Binary bodies travel as one byte per Character in both directions.
   procedure Test_Binary (Client : UARP.Client.Client_Type) is
      Downloaded : constant Text := UARP.Client.Call_Raw (Client, "GET", "/bytes");
      Expected   : constant String :=
        Character'Val (0) & Character'Val (16#FF#) & 'A' & Character'Val (0) & 'B';
   begin
      Check ("a binary download keeps every byte", (+Downloaded) = Expected,
             "got" & Natural'Image (SU.Length (Downloaded)) & " bytes");

      declare
         Uploaded : constant JS.JSON_Value :=
           JS.Parse
             (+UARP.Client.Call_Raw
                (Client, "POST", "/bytes/echo",
                 Payload      => Expected,
                 Has_Payload  => True,
                 Content_Type => "application/octet-stream"));
      begin
         --  A NUL in the payload must not truncate the request.
         Check ("a binary upload keeps every byte",
                JS.Get_Integer (Uploaded, "length") = 5,
                Integer_Value'Image (JS.Get_Integer (Uploaded, "length")));
      end;
   end Test_Binary;

   procedure Test_HTTP (Base : String) is
      Client : constant UARP.Client.Client_Type :=
        UARP.Client.Create ("uarp_test1234_secret", Base, Timeout_Ms => 5_000, Max_Retries => 2);
      Query  : Pair_Vectors.Vector;
   begin
      IO.Put_Line ("http (" & Base & ")");

      Add (Query, "limit", Integer_Value'(25));
      declare
         Echo : constant JS.JSON_Value :=
           UARP.Client.Call (Client, "GET", "/echo", Query => Query);
      begin
         Check_Equal ("the method reaches the server", +JS.Get_Text (Echo, "method"), "GET");
         Check_Equal ("the path reaches the server", +JS.Get_Text (Echo, "path"), "/echo");
         Check_Equal ("query parameters are sent", +JS.Get_Text (Echo, "query"), "limit=25");
         Check_Equal ("the bearer token is sent",
                      +JS.Get_Text (Echo, "authorization"), "Bearer uarp_test1234_secret");
         Check ("the user agent identifies the SDK",
                Ada.Strings.Fixed.Index (+JS.Get_Text (Echo, "user_agent"), "uarp-sdk-ada/") = 1);
      end;

      declare
         Payload : constant JS.JSON_Value := JS.New_Object;
         Echo    : JS.JSON_Value;
      begin
         JS.Set (Payload, "name", String'("demo"));
         Echo := UARP.Client.Call
           (Client, "POST", "/echo", Payload => Payload, Has_Payload => True, Idempotent => True);
         Check_Equal ("the JSON body is sent", +JS.Get_Text (Echo, "body"), "{""name"":""demo""}");
         Check ("writes carry an idempotency key",
                SU.Length (JS.Get_Text (Echo, "idempotency_key")) = 36);
      end;

      declare
         Ignored : JS.JSON_Value;
      begin
         Ignored := UARP.Client.Call (Client, "GET", "/status/404");
         Check ("a 404 raises", False, JS.Serialize (Ignored));
      exception
         when Error : UARP.Errors.API_Error =>
            Check ("a 404 raises API_Error with detail",
                   Ada.Strings.Fixed.Index
                     (Ada.Exceptions.Exception_Message (Error), "not found here") > 0,
                   Ada.Exceptions.Exception_Message (Error));
      end;

      declare
         --  The mock answers 429 once, then 200.
         Recovered : constant JS.JSON_Value := UARP.Client.Call (Client, "GET", "/flaky");
      begin
         Check_Equal ("a 429 is retried", +JS.Get_Text (Recovered, "status"), "recovered");
      end;

      declare
         Status    : Natural;
         Body_Text : Text;
         Problem   : UARP.Errors.Problem;
      begin
         UARP.Client.Execute
           (Client, "GET", "/status/422",
            Status => Status, Body_Text => Body_Text, Problem => Problem);
         Check ("Execute reports the status without raising", Status = 422);
         Check ("Execute reports field errors", Natural (Problem.Errors.Length) = 1);
      end;

      Test_Generated (Client);

      declare
         Events : Stream_Collector.Collector;
      begin
         UARP.Client.Stream (Client, "/events", Events);
         Check ("the stream delivered both events", Events.Count = 2,
                Natural'Image (Events.Count));
         Check_Equal ("events arrive in order", Events.Names, "llm.chunk,run.completed");
      end;

      Test_Concurrent_Streams (Client);
      Test_SSE_Token (Base);
      Test_Rate_Limit_Hints (Client);
      Test_Idempotency (Client);
      Test_Unknown_Enum;
      Test_Reconnect (Client);
      Test_No_Reconnect (Client);
      Test_Terminal_Event_Stops (Client);
      Test_Done_Frame_Stops (Client);
      Test_Watchdog_Reconnects_Silent_Socket (Client);
      Test_401_Surfaces_Without_Retry (Client);
      Test_Reports_Lifecycle_Via_On_State (Client);
      Test_Multipart (Client);
      Test_Binary (Client);
   end Test_HTTP;

begin
   IO.Put_Line ("UARP Ada SDK test suite");
   IO.New_Line;

   Test_Encoding;
   Test_SSE;
   Test_SSE_Decode_Parity;
   Test_JSON;
   Test_Errors;
   Test_Client_Configuration;

   if Ada.Environment_Variables.Exists ("UARP_TEST_BASE_URL") then
      Test_HTTP (Ada.Environment_Variables.Value ("UARP_TEST_BASE_URL"));
   else
      IO.Put_Line ("http: skipped (set UARP_TEST_BASE_URL to run against the mock server)");
   end if;

   IO.New_Line;
   IO.Put_Line
     ("passed:" & Natural'Image (Passed) & "   failed:" & Natural'Image (Failed));
   if Failed > 0 then
      Ada.Command_Line.Set_Exit_Status (Ada.Command_Line.Failure);
   end if;
end UARP_SDK_Tests;
