--  Prints assistant output as a run streams.
--
--  A sink is an ordinary object: put whatever state you need in the record,
--  declare it where you use it, and hand it to the streaming operation.

with UARP.SSE;

package Run_Printer is

   type Printer is limited new UARP.SSE.Event_Sink with private;

   overriding procedure Handle
     (Self     : in out Printer;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean);

   --  Number of assistant chunks printed.
   function Chunks (Self : Printer) return Natural;

private

   type Printer is limited new UARP.SSE.Event_Sink with record
      Seen : Natural := 0;
   end record;

end Run_Printer;
