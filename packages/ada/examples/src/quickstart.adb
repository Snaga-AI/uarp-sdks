--  Create an agent, start a run, follow it live, then page through history.
--
--     UARP_API_KEY=uarp_... alr run quickstart

with Ada.Command_Line;
with Ada.Exceptions;
with Ada.Text_IO;

with UARP.API.Agents;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.Models;
with UARP.Types;

with Run_Printer;

procedure Quickstart is

   use UARP.Types;
   package IO renames Ada.Text_IO;

   function Create_Agent (Client : UARP.Client.Client_Type) return UARP.Models.Agent;
   procedure Run_And_Follow (Client : UARP.Client.Client_Type; Agent_Id : String);
   procedure List_Everything (Client : UARP.Client.Client_Type);

   ------------------
   -- Create_Agent --
   ------------------

   function Create_Agent (Client : UARP.Client.Client_Type) return UARP.Models.Agent is
      Request : UARP.Models.Create_Agent_Request;
   begin
      Request.Name := +"quickstart";
      return UARP.API.Agents.Create (Client, Request);
   end Create_Agent;

   --------------------
   -- Run_And_Follow --
   --------------------

   procedure Run_And_Follow (Client : UARP.Client.Client_Type; Agent_Id : String) is
      Request : UARP.Models.Create_Run_Request;
   begin
      Request.Agent_Id := +Agent_Id;
      declare
         Run    : constant UARP.Models.Run := UARP.API.Runs.Create (Client, Request);
         Output : Run_Printer.Printer;
      begin
         --  The sink receives every event; setting Continue to False closes
         --  the connection.
         UARP.API.Runs.Stream_Run_Events (Client, +Run.Run_Id, Sink => Output);
         IO.Put_Line ("chunks:" & Natural'Image (Output.Chunks));
      end;
   end Run_And_Follow;

   ---------------------
   -- List_Everything --
   ---------------------

   procedure List_Everything (Client : UARP.Client.Client_Type) is
      Params : UARP.API.Agents.List_Agents_Params;
   begin
      Params.Has_Limit := True;
      Params.Limit := 50;

      --  List_All walks every page; List returns one page plus its cursor.
      for Agent of UARP.API.Agents.List_All (Client, Params) loop
         IO.Put_Line ((+Agent.Agent_Id) & "  " & (+Agent.Name));
      end loop;
   end List_Everything;

   Client : UARP.Client.Client_Type := UARP.Client.Create ("placeholder");

begin
   Client := UARP.Client.From_Environment;

   declare
      Agent : constant UARP.Models.Agent := Create_Agent (Client);
   begin
      Run_And_Follow (Client, +Agent.Agent_Id);
   end;

   List_Everything (Client);

exception
   when Error : UARP.Errors.Configuration_Error =>
      IO.Put_Line (IO.Standard_Error, Ada.Exceptions.Exception_Message (Error));
      Ada.Command_Line.Set_Exit_Status (Ada.Command_Line.Failure);
   when Error : UARP.Errors.API_Error =>
      --  The message carries the status, title, detail and correlation id.
      --  Use UARP.Client.Execute when you want the problem document instead.
      IO.Put_Line (IO.Standard_Error, "API error: " & Ada.Exceptions.Exception_Message (Error));
      Ada.Command_Line.Set_Exit_Status (Ada.Command_Line.Failure);
   when Error : UARP.Errors.Transport_Error =>
      IO.Put_Line (IO.Standard_Error, "transport: " & Ada.Exceptions.Exception_Message (Error));
      Ada.Command_Line.Set_Exit_Status (Ada.Command_Line.Failure);
end Quickstart;
