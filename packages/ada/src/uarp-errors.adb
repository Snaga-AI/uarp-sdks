with Ada.Strings.Fixed;

package body UARP.Errors is

   function Numeric_Header (Item : Problem; Name : String) return Integer;

   --------------
   -- Classify --
   --------------

   function Classify (Status : Natural) return Error_Kind is
   begin
      case Status is
         when 400 => return Bad_Request;
         when 401 => return Authentication;
         when 403 => return Permission_Denied;
         when 404 => return Not_Found;
         when 409 => return Conflict;
         when 410 => return Gone;
         when 413 => return Payload_Too_Large;
         when 422 => return Unprocessable_Entity;
         when 429 => return Rate_Limit;
         when 503 => return Service_Unavailable;
         when 500 .. 502 | 504 .. 599 => return Server_Error;
         when others => return Other_Error;
      end case;
   end Classify;

   ------------------
   -- Is_Retryable --
   ------------------

   function Is_Retryable (Status : Natural) return Boolean is
     (Status in 408 | 409 | 429 | 500 | 502 | 503 | 504);

   -------------------------
   -- Retry_After_Seconds --
   -------------------------

   function Retry_After_Seconds (Item : Problem) return Duration is
      Raw : constant String := Lookup (Item.Headers, "retry-after");
   begin
      if Raw'Length = 0 then
         return -1.0;
      end if;
      return Duration'Value (Raw);
   exception
      when Constraint_Error =>
         --  The HTTP-date form is not converted; callers fall back to backoff.
         return -1.0;
   end Retry_After_Seconds;

   --------------------
   -- Numeric_Header --
   --------------------

   function Numeric_Header (Item : Problem; Name : String) return Integer is
      Raw : constant String := Lookup (Item.Headers, Name);
   begin
      if Raw'Length = 0 then
         return -1;
      end if;
      return Integer'Value (Raw);
   exception
      when Constraint_Error =>
         return -1;
   end Numeric_Header;

   function Rate_Limit_Remaining (Item : Problem) return Integer is
     (Numeric_Header (Item, "x-ratelimit-remaining"));

   function Rate_Limit_Reset (Item : Problem) return Integer is
     (Numeric_Header (Item, "x-ratelimit-reset"));

   -----------
   -- Image --
   -----------

   function Image (Item : Problem; Status : Natural) return String is
      Code    : constant String :=
        Ada.Strings.Fixed.Trim (Natural'Image (Status), Ada.Strings.Both);
      Heading : constant String :=
        (if SU.Length (Item.Title) > 0 then +Item.Title else "HTTP error");
      Result  : Text := +(Code & " " & Heading);
   begin
      if SU.Length (Item.Detail) > 0 then
         SU.Append (Result, " - " & (+Item.Detail));
      end if;
      if SU.Length (Item.Correlation_Id) > 0 then
         SU.Append (Result, " (correlationId: " & (+Item.Correlation_Id) & ")");
      end if;
      for Failure of Item.Errors loop
         SU.Append (Result, "; " & (+Failure.Field) & ": " & (+Failure.Message));
      end loop;
      return +Result;
   end Image;

end UARP.Errors;
