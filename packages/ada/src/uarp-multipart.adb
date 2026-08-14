with Ada.Calendar;
with Ada.Numerics.Discrete_Random;

package body UARP.Multipart is

   CRLF : constant String := ASCII.CR & ASCII.LF;

   subtype Hex_Digit is Natural range 0 .. 15;
   package Hex_Random is new Ada.Numerics.Discrete_Random (Hex_Digit);

   Generator : Hex_Random.Generator;
   Hex_Chars : constant String := "0123456789abcdef";

   function New_Boundary return String;

   function New_Boundary return String is
      Suffix : String (1 .. 24);
   begin
      for Index in Suffix'Range loop
         Suffix (Index) := Hex_Chars (Hex_Random.Random (Generator) + 1);
      end loop;
      return "uarp-" & Suffix;
   end New_Boundary;

   -----------
   -- Reset --
   -----------

   procedure Reset (Self : in out Builder) is
   begin
      Self.Boundary := +New_Boundary;
      Self.Buffer := Empty_Text;
   end Reset;

   ---------------
   -- Add_Field --
   ---------------

   procedure Add_Field (Self : in out Builder; Name : String; Value : String) is
   begin
      if SU.Length (Self.Boundary) = 0 then
         Reset (Self);
      end if;
      SU.Append (Self.Buffer, "--" & (+Self.Boundary) & CRLF);
      SU.Append (Self.Buffer, "Content-Disposition: form-data; name=""" & Name & """" & CRLF & CRLF);
      SU.Append (Self.Buffer, Value & CRLF);
   end Add_Field;

   --------------
   -- Add_File --
   --------------

   procedure Add_File
     (Self         : in out Builder;
      Name         : String;
      Filename     : String;
      Data         : String;
      Content_Type : String := "application/octet-stream") is
   begin
      if SU.Length (Self.Boundary) = 0 then
         Reset (Self);
      end if;
      SU.Append (Self.Buffer, "--" & (+Self.Boundary) & CRLF);
      SU.Append
        (Self.Buffer,
         "Content-Disposition: form-data; name=""" & Name & """; filename=""" & Filename & """" & CRLF);
      SU.Append (Self.Buffer, "Content-Type: " & Content_Type & CRLF & CRLF);
      SU.Append (Self.Buffer, Data & CRLF);
   end Add_File;

   ------------------
   -- Content_Type --
   ------------------

   function Content_Type (Self : Builder) return String is
     ("multipart/form-data; boundary=" & (+Self.Boundary));

   ---------------
   -- Body_Text --
   ---------------

   function Body_Text (Self : Builder) return Text is
     (SU."&" (Self.Buffer, "--" & (+Self.Boundary) & "--" & CRLF));

begin
   Hex_Random.Reset (Generator, Integer (Ada.Calendar.Seconds (Ada.Calendar.Clock) * 1000.0));
end UARP.Multipart;
