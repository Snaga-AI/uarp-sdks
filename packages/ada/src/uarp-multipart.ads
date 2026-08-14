--  Builder for the handful of `multipart/form-data` endpoints.
--
--  The body is assembled in memory, which suits the platform's upload limits;
--  each Character of a part's data is one byte.

with UARP.Types;

package UARP.Multipart is

   use UARP.Types;

   type Builder is limited private;

   --  Start a body with a fresh, unguessable boundary.
   procedure Reset (Self : in out Builder);

   procedure Add_Field (Self : in out Builder; Name : String; Value : String);

   procedure Add_File
     (Self         : in out Builder;
      Name         : String;
      Filename     : String;
      Data         : String;
      Content_Type : String := "application/octet-stream");

   --  The value for the `Content-Type` header, boundary included.
   function Content_Type (Self : Builder) return String;

   --  The encoded body. Closes the final boundary, so call it last.
   function Body_Text (Self : Builder) return Text;

private

   type Builder is limited record
      Boundary : Text := Empty_Text;
      Buffer   : Text := Empty_Text;
   end record;

end UARP.Multipart;
