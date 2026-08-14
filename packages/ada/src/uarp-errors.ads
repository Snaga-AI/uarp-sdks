--  Error reporting.
--
--  Generated operations raise ``API_Error`` (or the transport-level errors
--  below) on failure. Because Ada exceptions carry only a message, callers that
--  need the structured problem document should use the non-raising
--  ``UARP.Client.Execute`` entry point, which returns the status and problem
--  directly.

with Ada.Containers.Vectors;

with UARP.Types;

package UARP.Errors is

   use UARP.Types;

   type Field_Error is record
      Field   : Text;
      Message : Text;
   end record;

   package Field_Error_Vectors is new Ada.Containers.Vectors
     (Index_Type => Positive, Element_Type => Field_Error);

   --  RFC 9457 problem document returned by the API on failure.
   type Problem is record
      Kind_URI       : Text;
      Title          : Text;
      Status         : Natural := 0;
      Detail         : Text;
      Correlation_Id : Text;
      --  Field-level validation failures, present on 422 responses.
      Errors         : Field_Error_Vectors.Vector;
      --  The raw body, in case it was not a problem document at all.
      Raw            : Text;
      --  Response headers, names lower-cased. They carry the retry and rate
      --  limit hints, which the problem document itself does not.
      Headers        : Pair_Vectors.Vector;
   end record;

   Empty_Problem : constant Problem := (Status => 0, others => <>);

   type Error_Kind is
     (Bad_Request,
      Authentication,
      Permission_Denied,
      Not_Found,
      Conflict,
      Gone,
      Payload_Too_Large,
      Unprocessable_Entity,
      Rate_Limit,
      Service_Unavailable,
      Server_Error,
      Other_Error);

   function Classify (Status : Natural) return Error_Kind;

   --  Whether retrying the very same request could plausibly succeed.
   function Is_Retryable (Status : Natural) return Boolean;

   --  Seconds the server asked the client to wait, or -1.0 when it did not say.
   function Retry_After_Seconds (Item : Problem) return Duration;

   --  Requests left in the current window, or -1 when the header is absent.
   function Rate_Limit_Remaining (Item : Problem) return Integer;

   --  Unix seconds at which the rate limit window resets, or -1.
   function Rate_Limit_Reset (Item : Problem) return Integer;

   --  Render a problem as a single human-readable line.
   function Image (Item : Problem; Status : Natural) return String;

   --  The server answered with a non-2xx status.
   API_Error : exception;

   --  The request never reached the server, or the connection dropped.
   Transport_Error : exception;

   --  The response body was not the shape the SDK expected.
   Decoding_Error : exception;

   --  The client was configured with something unusable.
   Configuration_Error : exception;

end UARP.Errors;
