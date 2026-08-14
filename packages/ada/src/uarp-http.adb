with Ada.Exceptions;
with Ada.Strings.Fixed;
with Interfaces.C.Strings;
with System.Address_To_Access_Conversions;

with UARP.Errors;

package body UARP.HTTP is

   package C renames Interfaces.C;
   package CS renames Interfaces.C.Strings;

   use type C.long;
   use type C.size_t;
   use type CS.chars_ptr;
   use type System.Address;

   Error_Buffer_Size : constant := 256; --  CURL_ERROR_SIZE

   ------------------------------
   -- Imports from uarp_curl.c --
   ------------------------------

   function Curl_Init return C.long
     with Import, Convention => C, External_Name => "uarp_curl_init";

   function Curl_Strerror (Code : C.long) return CS.chars_ptr
     with Import, Convention => C, External_Name => "uarp_curl_strerror";

   procedure Curl_Free (Pointer : System.Address)
     with Import, Convention => C, External_Name => "uarp_free";

   function Curl_Request
     (Method          : CS.chars_ptr;
      URL             : CS.chars_ptr;
      Headers         : System.Address;
      Header_Count    : C.int;
      Payload         : CS.chars_ptr;
      Payload_Length  : C.size_t;
      Timeout_Ms      : C.long;
      Out_Status      : System.Address;
      Out_Body        : System.Address;
      Out_Body_Length : System.Address;
      Out_Headers     : System.Address;
      Out_Head_Length : System.Address;
      Error           : System.Address) return C.long
     with Import, Convention => C, External_Name => "uarp_http_request";

   type Sink_Function is access function
     (Context : System.Address; Data : System.Address; Length : C.size_t) return C.size_t
     with Convention => C;

   function Curl_Stream
     (Method         : CS.chars_ptr;
      URL            : CS.chars_ptr;
      Headers        : System.Address;
      Header_Count   : C.int;
      Payload        : CS.chars_ptr;
      Payload_Length : C.size_t;
      Timeout_Ms     : C.long;
      Sink           : Sink_Function;
      Context        : System.Address;
      Out_Status     : System.Address;
      Error          : System.Address) return C.long
     with Import, Convention => C, External_Name => "uarp_http_stream";

   -----------------
   -- Local types --
   -----------------

   type Stream_State is limited record
      Handler : Chunk_Handler;
      --  Opaque to this package: handed straight back to the handler.
      Context : System.Address := System.Null_Address;
      Stopped : Boolean := False;
      Failed  : Boolean := False;
      Failure : Text;
   end record;

   package State_Conversions is new System.Address_To_Access_Conversions (Stream_State);
   use type State_Conversions.Object_Pointer;

   type Header_Buffer is array (Natural range <>) of aliased CS.chars_ptr;

   --------------------
   -- Local routines --
   --------------------

   --  Render the header vector as the `Name: Value` lines libcurl expects.
   function To_C_Headers (Headers : Pair_Vectors.Vector) return Header_Buffer;

   procedure Free (Buffer : in out Header_Buffer);

   --  `curl_global_init` is not thread-safe, and two tasks may now reach it at
   --  the same time.
   protected Curl_Setup is
      procedure Ensure;
   private
      Done : Boolean := False;
   end Curl_Setup;

   function Error_Text (Code : C.long; Buffer : C.char_array) return String;

   function To_C_Headers (Headers : Pair_Vectors.Vector) return Header_Buffer is
      Result : Header_Buffer (0 .. Natural (Headers.Length));
      Index  : Natural := 0;
   begin
      --  The array is one longer than needed so a zero-header request still has
      --  a valid address to hand to C.
      Result := (others => CS.Null_Ptr);
      for Item of Headers loop
         Result (Index) := CS.New_String ((+Item.Name) & ": " & (+Item.Value));
         Index := Index + 1;
      end loop;
      return Result;
   end To_C_Headers;

   procedure Free (Buffer : in out Header_Buffer) is
   begin
      for Pointer of Buffer loop
         if Pointer /= CS.Null_Ptr then
            CS.Free (Pointer);
         end if;
      end loop;
   end Free;

   protected body Curl_Setup is
      procedure Ensure is
         Code : C.long;
      begin
         if Done then
            return;
         end if;
         Code := Curl_Init;
         if Code /= 0 then
            raise UARP.Errors.Transport_Error
              with "libcurl initialisation failed with code" & C.long'Image (Code);
         end if;
         Done := True;
      end Ensure;
   end Curl_Setup;

   function Error_Text (Code : C.long; Buffer : C.char_array) return String is
      Detail : constant String := C.To_Ada (Buffer, Trim_Nul => True);
   begin
      if Detail'Length > 0 then
         return Detail;
      end if;
      return CS.Value (Curl_Strerror (Code));
   end Error_Text;

   ----------
   -- Send --
   ----------

   procedure Send
     (Method      : String;
      URL         : String;
      Headers     : Pair_Vectors.Vector;
      Payload     : String;
      Has_Payload : Boolean;
      Timeout_Ms  : Natural;
      Result      : out Response)
   is
      C_Method  : CS.chars_ptr := CS.New_String (Method);
      C_URL     : CS.chars_ptr := CS.New_String (URL);
      C_Payload : CS.chars_ptr :=
        (if Has_Payload then CS.New_String (Payload) else CS.Null_Ptr);
      C_Headers : Header_Buffer := To_C_Headers (Headers);

      Status        : aliased C.long := 0;
      --  Held as addresses rather than chars_ptr: a response body may contain
      --  NUL bytes, and Interfaces.C.Strings.Value stops at the first one.
      Body_Pointer  : aliased System.Address := System.Null_Address;
      Body_Length   : aliased C.size_t := 0;
      Head_Pointer  : aliased System.Address := System.Null_Address;
      Head_Length   : aliased C.size_t := 0;
      Error         : aliased C.char_array (0 .. Error_Buffer_Size - 1) := (others => C.nul);
      Code          : C.long;
   begin
      Curl_Setup.Ensure;
      Result := (Status => 0, Body_Text => Empty_Text, Headers => Pair_Vectors.Empty_Vector);

      Code := Curl_Request
        (Method          => C_Method,
         URL             => C_URL,
         Headers         => C_Headers (C_Headers'First)'Address,
         Header_Count    => C.int (Headers.Length),
         Payload         => C_Payload,
         Payload_Length  => C.size_t (if Has_Payload then Payload'Length else 0),
         Timeout_Ms      => C.long (Timeout_Ms),
         Out_Status      => Status'Address,
         Out_Body        => Body_Pointer'Address,
         Out_Body_Length => Body_Length'Address,
         Out_Headers     => Head_Pointer'Address,
         Out_Head_Length => Head_Length'Address,
         Error           => Error'Address);

      if Body_Pointer /= System.Null_Address then
         declare
            Raw : String (1 .. Natural (Body_Length)) with Import, Address => Body_Pointer;
         begin
            Result.Body_Text := +Raw;
         end;
         Curl_Free (Body_Pointer);
      end if;
      if Head_Pointer /= System.Null_Address then
         declare
            Raw : String (1 .. Natural (Head_Length)) with Import, Address => Head_Pointer;
         begin
            Result.Headers := Parse_Headers (Raw);
         end;
         Curl_Free (Head_Pointer);
      end if;

      CS.Free (C_Method);
      CS.Free (C_URL);
      if C_Payload /= CS.Null_Ptr then
         CS.Free (C_Payload);
      end if;
      Free (C_Headers);

      if Code /= 0 then
         raise UARP.Errors.Transport_Error with Error_Text (Code, Error);
      end if;
      Result.Status := Natural (Status);
   end Send;

   ----------
   -- Sink --
   ----------

   function Sink
     (Context : System.Address; Data : System.Address; Length : C.size_t) return C.size_t
     with Convention => C;

   function Sink
     (Context : System.Address; Data : System.Address; Length : C.size_t) return C.size_t
   is
      State : constant State_Conversions.Object_Pointer :=
        State_Conversions.To_Pointer (Context);
      Size  : constant Natural := Natural (Length);
      Chunk : String (1 .. Size) with Import, Address => Data;
   begin
      if State = null or else State.Handler = null then
         return 0;
      end if;
      if not State.Handler (State.Context, Chunk) then
         State.Stopped := True;
         --  A short write tells libcurl to abort the transfer.
         return 0;
      end if;
      return Length;
   exception
      --  An exception must never cross back into C.
      when Error : others =>
         State.Failed := True;
         State.Failure := +Ada.Exceptions.Exception_Message (Error);
         return 0;
   end Sink;

   ------------
   -- Stream --
   ------------

   procedure Stream
     (Method     : String;
      URL        : String;
      Headers    : Pair_Vectors.Vector;
      Timeout_Ms : Natural;
      Handler    : Chunk_Handler;
      Context    : System.Address;
      Status     : out Natural)
   is
      C_Method  : CS.chars_ptr := CS.New_String (Method);
      C_URL     : CS.chars_ptr := CS.New_String (URL);
      C_Headers : Header_Buffer := To_C_Headers (Headers);

      State      : aliased Stream_State := (Handler => Handler, Context => Context, others => <>);
      Raw_Status : aliased C.long := 0;
      Error      : aliased C.char_array (0 .. Error_Buffer_Size - 1) := (others => C.nul);
      Code       : C.long;
   begin
      Curl_Setup.Ensure;

      Code := Curl_Stream
        (Method         => C_Method,
         URL            => C_URL,
         Headers        => C_Headers (C_Headers'First)'Address,
         Header_Count   => C.int (Headers.Length),
         Payload        => CS.Null_Ptr,
         Payload_Length => 0,
         Timeout_Ms     => C.long (Timeout_Ms),
         Sink           => Sink'Access,
         Context        => State'Address,
         Out_Status     => Raw_Status'Address,
         Error          => Error'Address);

      CS.Free (C_Method);
      CS.Free (C_URL);
      Free (C_Headers);

      Status := Natural (Raw_Status);

      if State.Failed then
         raise UARP.Errors.Transport_Error with +State.Failure;
      end if;
      --  CURLE_WRITE_ERROR (23) is how a caller-requested stop reaches us.
      if Code /= 0 and then not (Code = 23 and then State.Stopped) then
         raise UARP.Errors.Transport_Error with Error_Text (Code, Error);
      end if;
   end Stream;

   -------------------
   -- Parse_Headers --
   -------------------

   function Parse_Headers (Block : String) return Pair_Vectors.Vector is
      Result : Pair_Vectors.Vector;
      First  : Positive := Block'First;
   begin
      while First <= Block'Last loop
         declare
            Stop : Natural := Ada.Strings.Fixed.Index (Block (First .. Block'Last), "" & ASCII.LF);
            Line_Last : Natural;
         begin
            if Stop = 0 then
               Stop := Block'Last + 1;
            end if;
            Line_Last := Stop - 1;
            if Line_Last >= First and then Block (Line_Last) = ASCII.CR then
               Line_Last := Line_Last - 1;
            end if;

            if Line_Last >= First then
               declare
                  Line  : constant String := Block (First .. Line_Last);
                  Colon : constant Natural := Ada.Strings.Fixed.Index (Line, ":");
               begin
                  --  Skip the `HTTP/1.1 200 OK` status lines.
                  if Colon > Line'First then
                     Result.Append
                       (Pair'(Name  => +Ada.Strings.Fixed.Trim
                                (Line (Line'First .. Colon - 1), Ada.Strings.Both),
                              Value => +Ada.Strings.Fixed.Trim
                                (Line (Colon + 1 .. Line'Last), Ada.Strings.Both)));
                  end if;
               end;
            end if;
            First := Stop + 1;
         end;
      end loop;
      return Result;
   end Parse_Headers;

end UARP.HTTP;
