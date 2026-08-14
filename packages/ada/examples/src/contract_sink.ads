--  Stops the contract stream once the run finishes.

with UARP.SSE;

package Contract_Sink is

   type Sink is limited new UARP.SSE.Event_Sink with null record;

   overriding procedure Handle
     (Self     : in out Sink;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean);

end Contract_Sink;
