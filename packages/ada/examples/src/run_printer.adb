with Ada.Strings.Unbounded;
with Ada.Text_IO;

package body Run_Printer is

   package SU renames Ada.Strings.Unbounded;

   ------------
   -- Handle --
   ------------

   overriding procedure Handle
     (Self     : in out Printer;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean)
   is
      Name : constant String := SU.To_String (Event.Name);
   begin
      if Name = "llm.chunk" then
         Self.Seen := Self.Seen + 1;
         Ada.Text_IO.Put (SU.To_String (Event.Data));
      end if;
      Continue := Name /= "run.completed" and then Name /= "run.failed";
      if not Continue then
         Ada.Text_IO.New_Line;
      end if;
   end Handle;

   ------------
   -- Chunks --
   ------------

   function Chunks (Self : Printer) return Natural is (Self.Seen);

end Run_Printer;
