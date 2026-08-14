with Ada.Strings.Unbounded;

package body Contract_Sink is

   package SU renames Ada.Strings.Unbounded;

   overriding procedure Handle
     (Self     : in out Sink;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean) is
   begin
      Continue := SU.To_String (Event.Name) /= "run.completed";
   end Handle;

end Contract_Sink;
