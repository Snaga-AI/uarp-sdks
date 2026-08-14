--  Records the events a streaming call delivers.
--
--  One object per stream: the SDK dispatches to the sink object it was given,
--  so two of these may be in flight at once without sharing anything.

with Ada.Strings.Unbounded;

with UARP.SSE;

package Stream_Collector is

   type Collector is limited new UARP.SSE.Event_Sink with private;

   overriding procedure Handle
     (Self     : in out Collector;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean);

   function Count (Self : Collector) return Natural;

   --  Comma-separated event names, in arrival order.
   function Names (Self : Collector) return String;

private

   type Collector is limited new UARP.SSE.Event_Sink with record
      Seen  : Natural := 0;
      Order : Ada.Strings.Unbounded.Unbounded_String;
   end record;

end Stream_Collector;
