with Ada.Strings.Unbounded;

with UARP.JSON_Support;

package body Contract_Sink is

   package SU renames Ada.Strings.Unbounded;

   overriding procedure Handle
     (Self     : in out Sink;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean) is
   begin
      Continue := SU.To_String (Event.Name) /= "run.completed";
   end Handle;

   overriding procedure Handle
     (Self     : in out Text_Sink;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean)
   is
      use UARP.JSON_Support.JSON;
      Chunk   : constant JSON_Value := UARP.JSON_Support.Parse (SU.To_String (Event.Data));
      Choices : JSON_Array;
   begin
      Continue := True;
      Self.Count := Self.Count + 1;
      if Chunk.Kind /= JSON_Object_Type or else not Chunk.Has_Field ("choices") then
         return;
      end if;
      Choices := Chunk.Get ("choices");
      if Length (Choices) = 0 then
         return;
      end if;
      declare
         First : constant JSON_Value := Get (Choices, 1);
      begin
         if First.Has_Field ("delta") and then First.Get ("delta").Has_Field ("content") then
            SU.Append (Self.Content, String'(First.Get ("delta").Get ("content")));
         end if;
      end;
   end Handle;

end Contract_Sink;
