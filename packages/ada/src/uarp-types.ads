--  Shared scalar aliases and container instantiations.

with Ada.Containers.Vectors;
with Ada.Strings.Unbounded;

package UARP.Types is

   package SU renames Ada.Strings.Unbounded;

   subtype Text is SU.Unbounded_String;

   --  Integer values on the wire; the platform emits JSON numbers that fit here.
   subtype Integer_Value is Long_Long_Integer;

   subtype Float_Value is Long_Float;

   Empty_Text : constant Text := SU.Null_Unbounded_String;

   --  `+"literal"` is the conventional Ada shorthand for building an
   --  unbounded string; both directions are provided.
   function "+" (Value : String) return Text renames SU.To_Unbounded_String;
   function "+" (Value : Text) return String renames SU.To_String;

   package Text_Vectors is new Ada.Containers.Vectors
     (Index_Type => Positive, Element_Type => Text, "=" => SU."=");

   package Integer_Vectors is new Ada.Containers.Vectors
     (Index_Type => Positive, Element_Type => Integer_Value);

   package Float_Vectors is new Ada.Containers.Vectors
     (Index_Type => Positive, Element_Type => Float_Value);

   package Boolean_Vectors is new Ada.Containers.Vectors
     (Index_Type => Positive, Element_Type => Boolean);

   --  A name/value pair, used for both headers and query parameters.
   type Pair is record
      Name  : Text;
      Value : Text;
   end record;

   package Pair_Vectors is new Ada.Containers.Vectors
     (Index_Type => Positive, Element_Type => Pair);

   subtype Header_List is Pair_Vectors.Vector;
   subtype Query_List is Pair_Vectors.Vector;

   No_Pairs : constant Pair_Vectors.Vector := Pair_Vectors.Empty_Vector;

   --  Append `Name=Value` unless the caller left it unset.
   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : String);
   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : Text);
   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : Integer_Value);
   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : Float_Value);
   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : Boolean);

   --  Look a header up case-insensitively; returns the empty string if absent.
   function Lookup (List : Pair_Vectors.Vector; Name : String) return String;

   --  Percent-encode a value for use as one URL path segment. Everything
   --  outside the RFC 3986 unreserved set is escaped, `/` included, so an
   --  identifier containing a slash cannot escape its segment.
   function Encode_Path_Segment (Value : String) return String;

   --  Percent-encode a query parameter name or value.
   function Encode_Query (Value : String) return String;

   --  Render `?a=1&b=2`, or the empty string when there is nothing to send.
   function Build_Query (Parameters : Pair_Vectors.Vector) return String;

   --  Trim trailing slashes and join with a single separator.
   function Join_URL (Base : String; Path : String) return String;

end UARP.Types;
