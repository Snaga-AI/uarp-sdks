--  Contract runner for the Ada SDK.
--
--  Performs the sequence in contract/SCENARIOS.md against the contract server.
--  It asserts nothing about the traffic: the server records it and run.sh
--  compares the five traces.
--
--     UARP_CONTRACT_BASE_URL=http://127.0.0.1:8940 alr run contract

with Ada.Command_Line;
with Ada.Strings.Fixed;
with Ada.Environment_Variables;
with Ada.Text_IO;

with UARP.API.Agents;
with UARP.API.Files;
with UARP.API.Registry;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.Types;

with Contract_Sink;

procedure Contract is

   use UARP.Types;
   package IO renames Ada.Text_IO;
   package JS renames UARP.JSON_Support;
   use type JS.JSON.JSON_Value_Type;

   --  GNATCOLL keeps object members in insertion order, so the probe sorts
   --  metadata keys before reporting them.
   package Text_Sorting is new UARP.Types.Text_Vectors.Generic_Sorting
     ("<" => UARP.Types.SU."<");

   --  A quote, a backslash, a newline, a tab, a non-ASCII letter and a
   --  character outside the basic plane, spelled out so the source stays
   --  ASCII.
   Awkward : constant String :=
     """q"" \ " & ASCII.LF & " " & ASCII.HT & " "
     & Character'Val (16#D1#) & Character'Val (16#8B#) & " "
     & Character'Val (16#F0#) & Character'Val (16#9F#)
     & Character'Val (16#98#) & Character'Val (16#80#);

   Base : constant String :=
     (if Ada.Environment_Variables.Exists ("UARP_CONTRACT_BASE_URL")
      then Ada.Environment_Variables.Value ("UARP_CONTRACT_BASE_URL")
      else "");
begin
   if Base'Length = 0 then
      IO.Put_Line (IO.Standard_Error, "UARP_CONTRACT_BASE_URL is not set");
      Ada.Command_Line.Set_Exit_Status (Ada.Command_Line.Failure);
      return;
   end if;

   declare
      Client : constant UARP.Client.Client_Type :=
        UARP.Client.Create
          ("uarp_contract_secret", Base, Timeout_Ms => 10_000, Max_Retries => 2);
   begin
      --  1. query serialisation
      declare
         Params : UARP.API.Agents.List_Agents_Params;
         Page   : UARP.Models.List_Agents_Response;
      begin
         Params.Has_Limit := True;
         Params.Limit := 2;
         Page := UARP.API.Agents.List (Client, Params);
         pragma Unreferenced (Page);
      end;

      --  2. path encoding
      declare
         Agent : constant UARP.Models.Agent :=
           UARP.API.Agents.Get (Client, "id with/slash");
      begin
         pragma Unreferenced (Agent);
      end;

      --  3. JSON body and the automatic idempotency key
      declare
         Request : UARP.Models.Create_Agent_Request;
         Created : UARP.Models.Agent;
      begin
         Request.Name := +"demo";
         Created := UARP.API.Agents.Create (Client, Request);
         pragma Unreferenced (Created);
      end;

      --  4. cursor paging, consumed to the end
      declare
         Params : UARP.API.Agents.List_Agents_Params;
         All_Of : constant UARP.Models.Agent_Vectors.Vector :=
           UARP.API.Agents.List_All (Client, Params);
      begin
         pragma Unreferenced (All_Of);
      end;

      --  5. a 429 that is retried
      declare
         Agent : constant UARP.Models.Agent := UARP.API.Agents.Get (Client, "retry-me");
      begin
         pragma Unreferenced (Agent);
      end;

      --  6. a 404 that is not
      declare
         Refused : Boolean := False;
      begin
         begin
            declare
               Agent : constant UARP.Models.Agent :=
                 UARP.API.Agents.Get (Client, "missing");
            begin
               pragma Unreferenced (Agent);
            end;
         exception
            when UARP.Errors.API_Error =>
               Refused := True;
         end;
         --  A scenario that silently does not happen would make the traces
         --  agree for the wrong reason.
         if not Refused then
            IO.Put_Line (IO.Standard_Error, "expected a 404");
            Ada.Command_Line.Set_Exit_Status (Ada.Command_Line.Failure);
            return;
         end if;
      end;

      --  7. an event stream, stopped by the caller
      declare
         Events : Contract_Sink.Sink;
      begin
         UARP.API.Runs.Stream_Run_Events (Client, "r1", Sink => Events);
      end;

      --  8. binary download
      declare
         Bytes : constant Text := UARP.API.Files.Download_File_Content (Client, "f1");
      begin
         pragma Unreferenced (Bytes);
      end;

      --  9. no content
      UARP.API.Files.Delete (Client, "f1");

      --  10. multipart upload
      declare
         Request : UARP.Models.Registry_Publish_Request;
         Result  : UARP.Models.Registry_Publish_Response;
      begin
         Request.Manifest := +"{""name"":""demo""}";
         Request.Artifact := +(Character'Val (0) & Character'Val (16#FF#) & 'A');
         Request.Has_Sha256 := True;
         Request.Sha256 := +"abc123";
         Result := UARP.API.Registry.Registry_Publish (Client, Request);
         pragma Unreferenced (Result);
      end;

      --  11. query encoding, spaces and reserved characters included
      declare
         Params : UARP.API.Agents.List_Agents_Params;
         Page   : UARP.Models.List_Agents_Response;
      begin
         Params.Has_Workspace_Id := True;
         --  "\u044B w&x=y" spelled out so the source stays ASCII.
         Params.Workspace_Id :=
           +(Character'Val (16#D1#) & Character'Val (16#8B#) & " w&x=y+z*!()~");
         Page := UARP.API.Agents.List (Client, Params);
         pragma Unreferenced (Page);
      end;

      --  12. a multibyte path segment
      declare
         Agent : constant UARP.Models.Agent :=
           UARP.API.Agents.Get
             (Client,
              Character'Val (16#D0#) & Character'Val (16#B0#)
              & Character'Val (16#D0#) & Character'Val (16#B3#)
              & Character'Val (16#D0#) & Character'Val (16#B5#)
              & Character'Val (16#D0#) & Character'Val (16#BD#)
              & Character'Val (16#D1#) & Character'Val (16#82#)
              & "/" & Character'Val (16#D1#) & Character'Val (16#8B#));
      begin
         pragma Unreferenced (Agent);
      end;

      --  13. a header parameter
      declare
         Params : UARP.API.Runs.Stream_Run_Events_Params;
         Events : Contract_Sink.Sink;
      begin
         Params.Has_Last_Event_Id := True;
         Params.Last_Event_Id := +"42";
         UARP.API.Runs.Stream_Run_Events (Client, "r1", Params => Params, Sink => Events);
      end;
      --  14. zero and false must survive, not be dropped as falsy
      declare
         Params : UARP.API.Agents.List_Agents_Params;
         Page   : UARP.Models.List_Agents_Response;
      begin
         Params.Has_Limit := True;
         Params.Limit := 0;
         Params.Has_Include_Offline := True;
         Params.Include_Offline := False;
         Page := UARP.API.Agents.List (Client, Params);
         pragma Unreferenced (Page);
      end;

      --  15. JSON string escaping and a zero in a body
      declare
         Request : UARP.Models.Create_Run_Request;
         Started : UARP.Models.Run;
      begin
         Request.Agent_Id := +Awkward;
         Request.Has_Session_Id := True;
         Request.Session_Id := UARP.Types.Empty_Text;
         Request.Has_Version := True;
         Request.Version := 0;
         Started := UARP.API.Runs.Create (Client, Request);
         pragma Unreferenced (Started);
      end;

      --  16. how the decoder handles a payload built to strain it
      declare
         Probe  : constant UARP.Models.Run := UARP.API.Runs.Get (Client, "probe");
         Probes : constant JS.JSON_Value := JS.New_Object;
         Report : constant JS.JSON_Value := JS.New_Object;
         Keys   : UARP.Types.Text := UARP.Types.Empty_Text;
         Ignored : JS.JSON_Value;

         function Image (Value : Integer_Value) return String is
           (Ada.Strings.Fixed.Trim (Integer_Value'Image (Value), Ada.Strings.Both));
      begin
         declare
            Names : UARP.Types.Text_Vectors.Vector;

            procedure Collect (Name : String; Value : JS.JSON_Value);

            procedure Collect (Name : String; Value : JS.JSON_Value) is
               pragma Unreferenced (Value);
            begin
               Names.Append (+Name);
            end Collect;
         begin
            if JS.JSON.Kind (Probe.Metadata) = JS.JSON.JSON_Object_Type then
               JS.JSON.Map_JSON_Object (Probe.Metadata, Collect'Access);
            end if;
            Text_Sorting.Sort (Names);
            for Name of Names loop
               if UARP.Types.SU.Length (Keys) > 0 then
                  UARP.Types.SU.Append (Keys, ",");
               end if;
               UARP.Types.SU.Append (Keys, Name);
            end loop;
         end;

         JS.Set (Probes, "status", UARP.Models.Image (Probe.Status));
         JS.Set (Probes, "error_is_absent", (if Probe.Has_Error then "false" else "true"));
         JS.Set (Probes, "step_seq",
                 (if Probe.Has_Step_Seq then Image (Probe.Step_Seq) else "absent"));
         JS.Set (Probes, "artifacts_count", Image (Integer_Value (Probe.Artifacts.Length)));
         JS.Set (Probes, "metadata_keys", Keys);
         JS.Set (Probes, "metrics_output_tokens",
                 (if Probe.Metrics.Has_Output_Tokens
                  then Image (Probe.Metrics.Output_Tokens) else "absent"));
         JS.Set (Probes, "metrics_input_tokens",
                 (if Probe.Metrics.Has_Input_Tokens
                  then Image (Probe.Metrics.Input_Tokens) else "absent"));
         JS.Set (Probes, "started_at_is_absent",
                 (if Probe.Has_Started_At then "false" else "true"));

         JS.Set (Report, "language", String'("ada"));
         JS.Set (Report, "probes", Probes);
         Ignored := UARP.Client.Call
           (Client, "POST", "/__report", Payload => Report, Has_Payload => True);
         pragma Unreferenced (Ignored);
      end;

   end;

   IO.Put_Line ("ada runner done");
end Contract;
