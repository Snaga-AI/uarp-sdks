with Ada.Calendar;
with Ada.Environment_Variables;
with Ada.Numerics.Discrete_Random;
with Ada.Strings.Fixed;
with System.Address_To_Access_Conversions;

with UARP.HTTP;
package body UARP.Client is

   package JS renames UARP.JSON_Support;

   Retryable_Statuses : constant array (Positive range <>) of Natural :=
     (408, 409, 429, 500, 502, 503, 504);

   subtype Hex_Digit is Natural range 0 .. 15;
   package Hex_Random is new Ada.Numerics.Discrete_Random (Hex_Digit);

   --  Idempotency keys only need to be unlikely to collide, not unguessable.
   Key_Generator : Hex_Random.Generator;

   Hex_Chars : constant String := "0123456789abcdef";

   function New_Idempotency_Key return String;
   function Backoff_Delay (Attempt : Natural) return Duration;
   function Retry_After (Headers : Pair_Vectors.Vector) return Duration;
   function Is_Retryable_Status (Status : Natural) return Boolean;

   function Request_Headers
     (Self         : Client_Type;
      Extra        : Pair_Vectors.Vector;
      Options      : Request_Options;
      Accepts      : String;
      Content_Type : String;
      Has_Payload  : Boolean;
      Key          : String) return Pair_Vectors.Vector;

   -------------------------
   -- New_Idempotency_Key --
   -------------------------

   function New_Idempotency_Key return String is
      Result : String (1 .. 36);
   begin
      for Index in Result'Range loop
         case Index is
            when 9 | 14 | 19 | 24 =>
               Result (Index) := '-';
            when 15 =>
               Result (Index) := '4';
            when 20 =>
               Result (Index) := Hex_Chars ((Hex_Random.Random (Key_Generator) mod 4) + 9);
            when others =>
               Result (Index) := Hex_Chars (Hex_Random.Random (Key_Generator) + 1);
         end case;
      end loop;
      return Result;
   end New_Idempotency_Key;

   -------------------
   -- Backoff_Delay --
   -------------------

   function Backoff_Delay (Attempt : Natural) return Duration is
      Capped : constant Duration :=
        Duration'Min (8.0, 0.5 * Duration (2 ** Natural'Min (Attempt, 4)));
      Fraction : constant Float := Float (Hex_Random.Random (Key_Generator)) / 15.0;
      Half     : constant Duration := Capped / 2;
   begin
      --  Full jitter: half the cap plus a random share of the other half.
      return Half + Duration (Float (Half) * Fraction);
   end Backoff_Delay;

   -----------------
   -- Retry_After --
   -----------------

   function Retry_After (Headers : Pair_Vectors.Vector) return Duration is
      Raw : constant String := Lookup (Headers, "retry-after");
   begin
      if Raw'Length = 0 then
         return -1.0;
      end if;
      return Duration'Value (Raw);
   exception
      when Constraint_Error =>
         --  Ignore the HTTP-date form; the backoff schedule covers it.
         return -1.0;
   end Retry_After;

   -------------------------
   -- Is_Retryable_Status --
   -------------------------

   function Is_Retryable_Status (Status : Natural) return Boolean is
   begin
      for Candidate of Retryable_Statuses loop
         if Candidate = Status then
            return True;
         end if;
      end loop;
      return False;
   end Is_Retryable_Status;

   ------------
   -- Create --
   ------------

   function Create
     (API_Key            : String;
      Base_URL           : String := Default_Base_URL;
      Timeout_Ms         : Natural := 60_000;
      Max_Retries        : Natural := 2;
      User_Agent_Suffix  : String := "";
      SSE_Token_In_Query : Boolean := False) return Client_Type
   is
      Agent : constant String :=
        "uarp-sdk-ada/" & SDK_Version
        & (if User_Agent_Suffix'Length > 0 then " " & User_Agent_Suffix else "");
   begin
      if API_Key'Length = 0 then
         raise UARP.Errors.Configuration_Error with "the API key must not be empty";
      end if;
      if Base_URL'Length = 0 then
         raise UARP.Errors.Configuration_Error with "the base URL must not be empty";
      end if;
      return
        (API_Key            => +API_Key,
         Base               => +Base_URL,
         Timeout_Ms         => Timeout_Ms,
         Max_Retries        => Max_Retries,
         User_Agent         => +Agent,
         SSE_Token_In_Query => SSE_Token_In_Query);
   end Create;

   ----------------------
   -- From_Environment --
   ----------------------

   function From_Environment return Client_Type is
      use Ada.Environment_Variables;

      function Setting (Name : String) return String is
        (if Exists (Name) then Value (Name) else "");

      Key  : constant String :=
        (if Setting ("UARP_API_KEY")'Length > 0
         then Setting ("UARP_API_KEY")
         else Setting ("SNAGA_API_KEY"));
      Base : constant String := Setting ("UARP_BASE_URL");
   begin
      if Key'Length = 0 then
         raise UARP.Errors.Configuration_Error with "UARP_API_KEY is not set";
      end if;
      return Create
        (API_Key  => Key,
         Base_URL => (if Base'Length > 0 then Base else Default_Base_URL));
   end From_Environment;

   --------------
   -- Base_URL --
   --------------

   function Base_URL (Self : Client_Type) return String is (+Self.Base);

   ---------------------
   -- Request_Headers --
   ---------------------

   function Request_Headers
     (Self         : Client_Type;
      Extra        : Pair_Vectors.Vector;
      Options      : Request_Options;
      Accepts      : String;
      Content_Type : String;
      Has_Payload  : Boolean;
      Key          : String) return Pair_Vectors.Vector
   is
      Result : Pair_Vectors.Vector;
   begin
      Add (Result, "Accept", Accepts);
      Add (Result, "User-Agent", +Self.User_Agent);
      Add (Result, "Authorization", "Bearer " & (+Self.API_Key));
      if Has_Payload then
         Add (Result, "Content-Type", Content_Type);
      end if;
      if Key'Length > 0 then
         Add (Result, "Idempotency-Key", Key);
      end if;
      for Item of Extra loop
         Result.Append (Item);
      end loop;
      for Item of Options.Extra_Headers loop
         Result.Append (Item);
      end loop;
      return Result;
   end Request_Headers;

   -------------
   -- Execute --
   -------------

   procedure Execute
     (Self         : Client_Type;
      Method       : String;
      Path         : String;
      Query        : Pair_Vectors.Vector := No_Pairs;
      Headers      : Pair_Vectors.Vector := No_Pairs;
      Payload      : String := "";
      Has_Payload  : Boolean := False;
      Content_Type : String := "application/json";
      Idempotent   : Boolean := False;
      Options      : Request_Options := Default_Options;
      Status       : out Natural;
      Body_Text    : out Text;
      Problem      : out UARP.Errors.Problem)
   is
      Retries : constant Natural :=
        (if Options.Max_Retries >= 0 then Natural (Options.Max_Retries) else Self.Max_Retries);
      Timeout : constant Natural :=
        (if Options.Timeout_Ms > 0 then Options.Timeout_Ms else Self.Timeout_Ms);
      Key     : constant String :=
        (if not Idempotent then ""
         elsif SU.Length (Options.Idempotency_Key) > 0 then +Options.Idempotency_Key
         else New_Idempotency_Key);
      --  Reads are always safe to repeat; writes only when the server can
      --  deduplicate them.
      Can_Retry : constant Boolean := Method = "GET" or else Key'Length > 0;

      Full_Query : Pair_Vectors.Vector := Query;
      Attempt    : Natural := 0;
      Response   : UARP.HTTP.Response;
   begin
      for Item of Options.Extra_Query loop
         Full_Query.Append (Item);
      end loop;

      loop
         UARP.HTTP.Send
           (Method      => Method,
            URL         => Join_URL (+Self.Base, Path) & Build_Query (Full_Query),
            Headers     => Request_Headers
              (Self, Headers, Options, "application/json", Content_Type, Has_Payload, Key),
            Payload     => Payload,
            Has_Payload => Has_Payload,
            Timeout_Ms  => Timeout,
            Result      => Response);

         exit when Response.Status in 200 .. 299;

         declare
            Should_Retry : constant Boolean :=
              Can_Retry
              and then Attempt < Retries
              and then Is_Retryable_Status (Response.Status)
              and then Lookup (Response.Headers, "x-should-retry") /= "false";
            Wait : Duration;
         begin
            exit when not Should_Retry;
            Wait := Retry_After (Response.Headers);
            if Wait < 0.0 then
               Wait := Backoff_Delay (Attempt);
            end if;
            Attempt := Attempt + 1;
            delay Duration'Min (Wait, 60.0);
         end;
      end loop;

      Status := Response.Status;
      Body_Text := Response.Body_Text;
      if Response.Status in 200 .. 299 then
         Problem := UARP.Errors.Empty_Problem;
      else
         Problem := To_Problem (+Response.Body_Text);
         Problem.Status := Response.Status;
         --  The retry and rate-limit hints live in the headers, not the body.
         Problem.Headers := Response.Headers;
      end if;
   end Execute;

   ----------------
   -- To_Problem --
   ----------------

   function To_Problem (Body_Text : String) return UARP.Errors.Problem is
      use UARP.Errors;
      Result : Problem;
   begin
      Result.Raw := +Body_Text;
      if Body_Text'Length = 0 then
         return Result;
      end if;

      declare
         Document : JS.JSON_Value;
         Failures : JS.JSON_Array;
      begin
         --  Parsing happens in the statement part: an exception raised while
         --  elaborating a declaration would escape this block's handler.
         Document := JS.Parse (Body_Text);
         Failures := JS.Get_Array (Document, "errors");
         Result.Kind_URI := JS.Get_Text (Document, "type");
         Result.Title := JS.Get_Text (Document, "title");
         Result.Status := Natural (Integer_Value'Max (0, JS.Get_Integer (Document, "status")));
         Result.Detail := JS.Get_Text (Document, "detail");
         Result.Correlation_Id := JS.Get_Text (Document, "correlationId");
         for Index in 1 .. JS.JSON.Length (Failures) loop
            declare
               Item : constant JS.JSON_Value := JS.JSON.Get (Failures, Index);
            begin
               Result.Errors.Append
                 (Field_Error'(Field   => JS.Get_Text (Item, "field"),
                               Message => JS.Get_Text (Item, "message")));
            end;
         end loop;
      exception
         when Decoding_Error =>
            --  Not a problem document: keep the raw text and move on.
            null;
      end;
      return Result;
   end To_Problem;

   ----------
   -- Call --
   ----------

   function Call
     (Self        : Client_Type;
      Method      : String;
      Path        : String;
      Query       : Pair_Vectors.Vector := No_Pairs;
      Headers     : Pair_Vectors.Vector := No_Pairs;
      Payload     : JSON_Value := UARP.JSON_Support.Null_Value;
      Has_Payload : Boolean := False;
      Idempotent  : Boolean := False;
      Options     : Request_Options := Default_Options) return JSON_Value
   is
      Body_Text : constant Text :=
        Call_Raw
          (Self         => Self,
           Method       => Method,
           Path         => Path,
           Query        => Query,
           Headers      => Headers,
           Payload      => (if Has_Payload then JS.Serialize (Payload) else ""),
           Has_Payload  => Has_Payload,
           Content_Type => "application/json",
           Idempotent   => Idempotent,
           Options      => Options);
      Text_Value : constant String := +Body_Text;
   begin
      if Ada.Strings.Fixed.Trim (Text_Value, Ada.Strings.Both) = "" then
         return JS.Null_Value;
      end if;
      return JS.Parse (Text_Value);
   end Call;

   procedure Call_And_Discard
     (Self        : Client_Type;
      Method      : String;
      Path        : String;
      Query       : Pair_Vectors.Vector := No_Pairs;
      Headers     : Pair_Vectors.Vector := No_Pairs;
      Payload     : JSON_Value := UARP.JSON_Support.Null_Value;
      Has_Payload : Boolean := False;
      Idempotent  : Boolean := False;
      Options     : Request_Options := Default_Options)
   is
      Ignored : constant Text :=
        Call_Raw
          (Self         => Self,
           Method       => Method,
           Path         => Path,
           Query        => Query,
           Headers      => Headers,
           Payload      => (if Has_Payload then JS.Serialize (Payload) else ""),
           Has_Payload  => Has_Payload,
           Content_Type => "application/json",
           Idempotent   => Idempotent,
           Options      => Options);
   begin
      pragma Unreferenced (Ignored);
      null;
   end Call_And_Discard;

   --------------
   -- Call_Raw --
   --------------

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
      Options      : Request_Options := Default_Options) return Text
   is
      Status    : Natural;
      Body_Text : Text;
      Problem   : UARP.Errors.Problem;
   begin
      Execute
        (Self         => Self,
         Method       => Method,
         Path         => Path,
         Query        => Query,
         Headers      => Headers,
         Payload      => Payload,
         Has_Payload  => Has_Payload,
         Content_Type => Content_Type,
         Idempotent   => Idempotent,
         Options      => Options,
         Status       => Status,
         Body_Text    => Body_Text,
         Problem      => Problem);

      if Status not in 200 .. 299 then
         raise UARP.Errors.API_Error with UARP.Errors.Image (Problem, Status);
      end if;
      return Body_Text;
   end Call_Raw;

   ------------
   -- Stream --
   ------------

   --  Streaming state lives on the caller's stack. The transport carries its
   --  address through to the chunk handler, so concurrent streams share nothing.
   type Stream_Context is limited record
      Sink : access UARP.SSE.Event_Sink'Class;
      Parser : UARP.SSE.Parser;
      Active : Boolean := True;
      --  Replayed as `Last-Event-ID` when the stream is reopened.
      Last_Id : Text := Empty_Text;
      Has_Last_Id : Boolean := False;
      --  Whether this connection produced anything, which is what earns a
      --  fresh reconnect budget.
      Delivered : Boolean := False;
   end record;

   package Stream_Conversions is
     new System.Address_To_Access_Conversions (Stream_Context);
   use type Stream_Conversions.Object_Pointer;

   function On_Chunk (Context : System.Address; Data : String) return Boolean;

   function On_Chunk (Context : System.Address; Data : String) return Boolean is
      State  : constant Stream_Conversions.Object_Pointer :=
        Stream_Conversions.To_Pointer (Context);
      Events : UARP.SSE.Event_Vectors.Vector;
   begin
      if State = null or else State.Sink = null then
         return False;
      end if;
      UARP.SSE.Feed (State.Parser, Data, Events);
      for Event of Events loop
         if Event.Has_Id then
            State.Last_Id := Event.Id;
            State.Has_Last_Id := True;
         end if;
         State.Delivered := True;
         State.Sink.Handle (Event, State.Active);
         exit when not State.Active;
      end loop;
      return State.Active;
   end On_Chunk;

   procedure Stream
     (Self    : Client_Type;
      Path    : String;
      Sink    : in out UARP.SSE.Event_Sink'Class;
      Query   : Pair_Vectors.Vector := No_Pairs;
      Headers : Pair_Vectors.Vector := No_Pairs;
      Options : Request_Options := Default_Options)
   is
      --  The reference never outlives this call, so the accessibility check
      --  the compiler would apply is not the one that matters here.
      State      : aliased Stream_Context := (Sink => Sink'Unchecked_Access, others => <>);
      Full_Query : Pair_Vectors.Vector := Query;
      Status     : Natural;
      Timeout    : constant Natural :=
        (if Options.Timeout_Ms > 0 then Options.Timeout_Ms else 0);
      Last_Event : UARP.SSE.Server_Event;
      Has_Last   : Boolean;
      Attempt    : Natural := 0;
   begin
      for Item of Options.Extra_Query loop
         Full_Query.Append (Item);
      end loop;
      if Self.SSE_Token_In_Query then
         Add (Full_Query, "token", +Self.API_Key);
      end if;

      loop
         State.Delivered := False;
         UARP.SSE.Reset (State.Parser);

         declare
            Attempt_Headers : Pair_Vectors.Vector := Headers;
         begin
            if State.Has_Last_Id then
               Add (Attempt_Headers, "Last-Event-ID", State.Last_Id);
            end if;

            UARP.HTTP.Stream
              (Method     => "GET",
               URL        => Join_URL (+Self.Base, Path) & Build_Query (Full_Query),
               Headers    => Request_Headers
                 (Self, Attempt_Headers, Options, "text/event-stream", "application/json",
                  False, ""),
               Timeout_Ms => Timeout,
               Handler    => On_Chunk'Access,
               Context    => State'Address,
               Status     => Status);
         end;

         if Status not in 200 .. 299 then
            raise UARP.Errors.API_Error
              with UARP.Errors.Image (UARP.Errors.Empty_Problem, Status);
         end if;

         --  A frame the connection cut short still counts.
         if State.Active then
            UARP.SSE.Finish (State.Parser, Last_Event, Has_Last);
            if Has_Last then
               if Last_Event.Has_Id then
                  State.Last_Id := Last_Event.Id;
                  State.Has_Last_Id := True;
               end if;
               State.Delivered := True;
               Sink.Handle (Last_Event, State.Active);
            end if;
         end if;

         exit when not State.Active;
         exit when not Options.Reconnect;

         if State.Delivered then
            Attempt := 0;
         end if;
         exit when Attempt >= Options.Max_Reconnects;

         delay Backoff_Delay (Attempt);
         Attempt := Attempt + 1;
      end loop;
   end Stream;

begin
   Hex_Random.Reset (Key_Generator, Integer (Ada.Calendar.Seconds (Ada.Calendar.Clock) * 1000.0));
end UARP.Client;
