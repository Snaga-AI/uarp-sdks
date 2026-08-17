--  UARP - Ada client for the Snaga Universal Agent Runtime Platform API.
--
--  The transport, error, pagination and SSE layers under UARP.* are written by
--  hand; UARP.Models and UARP.API.* are generated from spec/openapi.json.
--
--     declare
--        Client : constant UARP.Client.Client_Type :=
--          UARP.Client.From_Environment;
--        Page : constant UARP.Models.List_Agents_Response :=
--          UARP.API.Agents.List (Client);
--     begin
--        ...
--     end;

package UARP is

   --  Version of this SDK. The authoritative copy lives in UARP.Meta, which the
   --  generator writes from the repository VERSION file; this constant exists so
   --  the hand-written client can name it without depending on generated code.
   SDK_Version : constant String := "0.5.3";

end UARP;
