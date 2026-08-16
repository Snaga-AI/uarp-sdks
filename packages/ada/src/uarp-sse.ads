--  Server-sent events: an incremental frame decoder.
--
--  ``UARP.Client.Stream`` drives this; you rarely need it directly, but it is
--  public so an application can decode an event stream it obtained elsewhere.

with Ada.Containers.Vectors;

with UARP.Types;

package UARP.SSE is

   use UARP.Types;

   --  One decoded `text/event-stream` frame.
   type Server_Event is record
      --  `id:` field (or the `event_id` inside a JSON payload), replayed as
      --  `Last-Event-ID` when the stream reconnects.
      Id        : Text;
      Has_Id    : Boolean := False;
      --  `event:` field; defaults to "message" or, when absent, to the `type`
      --  field inside a JSON data payload.
      Name      : Text;
      --  Concatenated `data:` lines, without the trailing newline.
      Data      : Text;
      --  `retry:` field in milliseconds.
      Retry_Ms  : Natural := 0;
      Has_Retry : Boolean := False;
   end record;

   package Event_Vectors is new Ada.Containers.Vectors
     (Index_Type => Positive, Element_Type => Server_Event);

   --  An optional string: the result of peeking a JSON field without decoding.
   type Optional_Text is record
      Value     : Text;
      Has_Value : Boolean := False;
   end record;

   --  Receives every event of a stream.
   --
   --  Derive from this interface, put whatever state the handler needs in the
   --  derived type, and pass the object to the streaming operation. Setting
   --  ``Continue`` to False closes the connection.
   --
   --     type Printer is limited new UARP.SSE.Event_Sink with null record;
   --     overriding procedure Handle
   --       (Self : in out Printer; Event : Server_Event; Continue : in out Boolean);
   --
   --  An interface rather than an access-to-subprogram: the object may be a
   --  local variable, and two tasks may stream at once without sharing state.
   type Event_Sink is limited interface;

   procedure Handle
     (Self     : in out Event_Sink;
      Event    : Server_Event;
      Continue : in out Boolean) is abstract;

   type Parser is limited private;

   --  Feed a chunk of the response body; completed frames land in ``Events``.
   procedure Feed
     (Self   : in out Parser;
      Chunk  : String;
      Events : in out Event_Vectors.Vector);

   --  Drop any half-read frame, ready for a fresh connection.
   procedure Reset (Self : in out Parser);

   --  Flush a frame the connection cut short.
   procedure Finish
     (Self      : in out Parser;
      Event     : out Server_Event;
      Has_Event : out Boolean);

   --  True once a ``data: [DONE]`` frame arrived — the stream terminates
   --  without reconnecting.
   function Is_Done (Self : Parser) return Boolean;

   --  Pull one string field out of a JSON body WITHOUT fully decoding it —
   --  the stream carries thousands of frames a minute, and a full parse per
   --  frame to learn its ``type`` is the difference between a smooth stream
   --  and a stuttering one.  Honours escaped quotes so a ``"`` inside a value
   --  can't fool it.
   function Extract_Field (JSON : String; Field : String) return Optional_Text;

   --  The ``type`` field of a JSON frame, peeked without decoding.
   function Extract_Event_Type (JSON : String) return Optional_Text;

private

   type Parser is limited record
      Buffer     : Text;
      Data_Lines : Text;
      Has_Data   : Boolean := False;
      Name       : Text;
      Id         : Text;
      Has_Id     : Boolean := False;
      Retry_Ms   : Natural := 0;
      Has_Retry  : Boolean := False;
      Has_Fields : Boolean := False;
      Done       : Boolean := False;
   end record;

end UARP.SSE;