--  Thin HTTP transport over libcurl.
--
--  Everything that touches the C library lives here; the rest of the SDK works
--  with Ada strings and vectors.

with System;

with UARP.Types;

package UARP.HTTP is

   use UARP.Types;

   type Response is record
      Status  : Natural := 0;
      Body_Text : Text;
      Headers : Pair_Vectors.Vector;
   end record;

   --  Issue one request and buffer the whole response.
   --
   --  Raises ``UARP.Errors.Transport_Error`` when the request never produced a
   --  response; an HTTP error status is reported through ``Result.Status``, not
   --  as an exception.
   procedure Send
     (Method     : String;
      URL        : String;
      Headers    : Pair_Vectors.Vector;
      Payload    : String;
      Has_Payload : Boolean;
      Timeout_Ms : Natural;
      Result     : out Response);

   --  Called for every chunk of a streaming response. ``Context`` is whatever
   --  was handed to ``Stream``; returning False stops the transfer and closes
   --  the connection immediately.
   type Chunk_Handler is access function
     (Context : System.Address; Data : String) return Boolean;

   --  Issue a streaming request, handing each chunk to ``Handler``.
   --
   --  All state travels through ``Context``, so concurrent streams never share
   --  anything.
   procedure Stream
     (Method     : String;
      URL        : String;
      Headers    : Pair_Vectors.Vector;
      Timeout_Ms : Natural;
      Handler    : Chunk_Handler;
      Context    : System.Address;
      Status     : out Natural);

   --  Split a raw response header block into name/value pairs.
   function Parse_Headers (Block : String) return Pair_Vectors.Vector;

end UARP.HTTP;
