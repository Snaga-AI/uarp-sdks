--  Stops the contract stream once the run finishes.

with UARP.SSE;
with UARP.Types;

package Contract_Sink is

   type Sink is limited new UARP.SSE.Event_Sink with null record;

   overriding procedure Handle
     (Self     : in out Sink;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean);

   --  Scenario 17: concatenates `choices[0].delta.content` of every event of
   --  a streamed completion, the way a caller assembles the answer.
   type Text_Sink is limited new UARP.SSE.Event_Sink with record
      Content : UARP.Types.Text;
      Count   : Natural := 0;
   end record;

   overriding procedure Handle
     (Self     : in out Text_Sink;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean);

end Contract_Sink;
