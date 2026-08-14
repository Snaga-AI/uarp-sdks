--  Live runner for the Ada SDK.
--
--  Performs smoke/live/SCENARIO.md against the real server and prints one JSON
--  object. It asserts almost nothing itself: compare.py decides whether the
--  five languages agree.
--
--     UARP_API_KEY=... alr run live

with Ada.Command_Line;
with Ada.Environment_Variables;
with Ada.Exceptions;
with Ada.Strings.Fixed;
with Ada.Text_IO;

with UARP.API.Agents;
with UARP.API.Auth;
with UARP.API.Health;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.Types;

procedure Live is

   use UARP.Types;
   package IO renames Ada.Text_IO;

   Language   : constant String := "ada";
   Agent_Name : constant String := "smoke-live-" & Language;
   Missing_Id : constant String := "00000000-0000-4000-8000-000000000000";

   --  Reported in place of a value the SDK could not read. The wording is
   --  shared by all five runners so that "both failed" compares equal; the
   --  reason goes to standard error, where it does not affect the comparison.
   Decode_Failed : constant String := "decode failed";

   Fields : UARP.Types.Text := Empty_Text;

   --  The report is assembled by hand rather than through the JSON writer:
   --  every value here is a literal, and a string of appends is easier to read
   --  than a tree of nodes.
   procedure Put (Name : String; Value : String; Quoted : Boolean := True) is
   begin
      if SU.Length (Fields) > 0 then
         SU.Append (Fields, ",");
      end if;
      SU.Append (Fields, """" & Name & """:");
      if Quoted then
         SU.Append (Fields, """" & Value & """");
      else
         SU.Append (Fields, Value);
      end if;
   end Put;

   procedure Put (Name : String; Value : Boolean) is
   begin
      Put (Name, (if Value then "true" else "false"), Quoted => False);
   end Put;

   procedure Put (Name : String; Value : Integer) is
   begin
      Put (Name, Ada.Strings.Fixed.Trim (Integer'Image (Value), Ada.Strings.Both), Quoted => False);
   end Put;

   --  `API_Error` carries its message as text beginning with the status, so
   --  that is where the code has to come from. The other four SDKs expose the
   --  status and the problem document as data; this one does not, which is a
   --  gap in the Ada surface rather than in the scenario.
   function Status_Of (Message : String) return Integer is
      Last : Natural := Message'First - 1;
   begin
      for Index in Message'Range loop
         exit when Message (Index) not in '0' .. '9';
         Last := Index;
      end loop;
      if Last < Message'First then
         return 0;
      end if;
      return Integer'Value (Message (Message'First .. Last));
   end Status_Of;

   function Has_Title (Message : String) return Boolean is
      --  `Image` falls back to "HTTP error" when the problem carried no title.
      Marker : constant String := "HTTP error";
   begin
      return Ada.Strings.Fixed.Index (Message, Marker) = 0;
   end Has_Title;

   API_Key : constant String :=
     (if Ada.Environment_Variables.Exists ("UARP_API_KEY")
      then Ada.Environment_Variables.Value ("UARP_API_KEY")
      else "");
   Base : constant String :=
     (if Ada.Environment_Variables.Exists ("UARP_BASE_URL")
      then Ada.Environment_Variables.Value ("UARP_BASE_URL")
      else "https://api.snaga.ai");

begin
   if API_Key'Length = 0 then
      IO.Put_Line (IO.Standard_Error, "UARP_API_KEY is not set");
      Ada.Command_Line.Set_Exit_Status (Ada.Command_Line.Failure);
      return;
   end if;

   declare
      Client : constant UARP.Client.Client_Type :=
        UARP.Client.Create (API_Key, Base, Timeout_Ms => 30_000, Max_Retries => 2);
      Created_Id : UARP.Types.Text := Empty_Text;
   begin
      Put ("language", Language);

      --  1. public health, no authorisation needed
      declare
         Health : constant UARP.Models.Get_Health_Response := UARP.API.Health.Get (Client);
      begin
         Put ("health", UARP.Models.Image (Health.Status));
      end;

      --  2. the key resolves to an identity
      declare
         Me : constant UARP.Models.Get_Me_Response := UARP.API.Auth.Get_Me (Client);
      begin
         Put ("role", +Me.Role);
         Put ("auth_method", UARP.Models.Image (Me.Auth_Method));
      end;

      --  3. a list with query parameters.
      --
      --  A decode failure is reported rather than propagated: the whole point
      --  of running five SDKs against one server is to see which of them
      --  cannot read what it sends, and an unhandled exception here would hide
      --  that instead of putting it in the comparison.
      declare
         Params : UARP.API.Agents.List_Agents_Params;
      begin
         Params.Has_Limit := True;
         Params.Limit := 2;
         declare
            Page : constant UARP.Models.List_Agents_Response :=
              UARP.API.Agents.List (Client, Params);
         begin
            Put ("page_size", Integer'Min (Integer (Page.Items.Length), 2));
         end;
      exception
         when Error : UARP.Errors.Decoding_Error =>
            IO.Put_Line
              (IO.Standard_Error, "page_size: " & Ada.Exceptions.Exception_Message (Error));
            Put ("page_size", Decode_Failed);
      end;

      --  4. a 404 that must arrive as an error carrying a problem document
      begin
         declare
            Agent : constant UARP.Models.Agent := UARP.API.Agents.Get (Client, Missing_Id);
         begin
            pragma Unreferenced (Agent);
            Put ("not_found_status", 0);
         end;
      exception
         when Error : UARP.Errors.API_Error =>
            declare
               Message : constant String := Ada.Exceptions.Exception_Message (Error);
            begin
               Put ("not_found_status", Status_Of (Message));
               Put ("problem_has_title", Has_Title (Message));
            end;
      end;

      --  5. a write, with the idempotency key the SDK attaches on its own
      begin
         declare
            Request : UARP.Models.Create_Agent_Request;
         begin
            Request.Name := +Agent_Name;
            declare
               Created : constant UARP.Models.Agent :=
                 UARP.API.Agents.Create (Client, Request);
            begin
               Created_Id := Created.Agent_Id;
               Put ("created", SU.Length (Created.Agent_Id) > 0);
            end;
         end;
      exception
         when Error : UARP.Errors.API_Error =>
            Put ("created", False);
            Put ("create_error", Status_Of (Ada.Exceptions.Exception_Message (Error)));
         when Error : UARP.Errors.Decoding_Error =>
            IO.Put_Line
              (IO.Standard_Error, "created: " & Ada.Exceptions.Exception_Message (Error));
            Put ("created", Decode_Failed);
      end;

      --  6. read it back, then 7. remove it again
      if SU.Length (Created_Id) > 0 then
         begin
            declare
               Fetched : constant UARP.Models.Agent :=
                 UARP.API.Agents.Get (Client, +Created_Id);
            begin
               Put ("name_round_trips", (+Fetched.Name) = Agent_Name);
            end;
         exception
            when Error : UARP.Errors.Decoding_Error =>
               IO.Put_Line
                 (IO.Standard_Error,
                  "name_round_trips: " & Ada.Exceptions.Exception_Message (Error));
               Put ("name_round_trips", Decode_Failed);
         end;

         begin
            declare
               Discarded : constant UARP.JSON_Support.JSON_Value :=
                 UARP.API.Agents.Delete (Client, +Created_Id);
            begin
               pragma Unreferenced (Discarded);
               Put ("deleted", True);
            end;
         exception
            when Error : UARP.Errors.API_Error =>
               Put ("deleted", False);
               Put ("delete_error", Status_Of (Ada.Exceptions.Exception_Message (Error)));
         end;
      end if;

      --  8. cursor pagination, stopped by the caller after six items
      declare
         Params : UARP.API.Agents.List_Agents_Params;
         Seen   : Natural := 0;
         More   : Boolean := True;
      begin
         Params.Has_Limit := True;
         Params.Limit := 2;
         while More and then Seen < 6 loop
            declare
               Page : constant UARP.Models.List_Agents_Response :=
                 UARP.API.Agents.List (Client, Params);
            begin
               for Item of Page.Items loop
                  pragma Unreferenced (Item);
                  Seen := Seen + 1;
                  exit when Seen >= 6;
               end loop;
               More := Page.Has_More and then Page.Has_Cursor;
               if More then
                  Params.Has_Cursor := True;
                  Params.Cursor := Page.Cursor;
               end if;
            end;
         end loop;
         Put ("paged_items", Seen);
      exception
         when Error : UARP.Errors.Decoding_Error =>
            IO.Put_Line
              (IO.Standard_Error, "paged_items: " & Ada.Exceptions.Exception_Message (Error));
            Put ("paged_items", Decode_Failed);
      end;

      IO.Put_Line ("{" & (+Fields) & "}");
   end;
end Live;
