--  Convenience layer over GNATCOLL.JSON used by the generated models.
--
--  Every getter is tolerant: a missing field, a JSON null, or a value of the
--  wrong kind yields the default rather than raising, so a server that adds or
--  reshapes a field cannot crash an existing client.

with GNATCOLL.JSON;

with UARP.Types;

package UARP.JSON_Support is

   use UARP.Types;
   package JSON renames GNATCOLL.JSON;

   subtype JSON_Value is JSON.JSON_Value;
   subtype JSON_Array is JSON.JSON_Array;

   --  True when the field exists and is not JSON null.
   function Present (Value : JSON_Value; Field : String) return Boolean;

   function Get_Text (Value : JSON_Value; Field : String) return Text;
   function Get_Integer (Value : JSON_Value; Field : String) return Integer_Value;
   function Get_Float (Value : JSON_Value; Field : String) return Float_Value;
   function Get_Boolean (Value : JSON_Value; Field : String) return Boolean;
   function Get_Array (Value : JSON_Value; Field : String) return JSON_Array;
   function Get_Value (Value : JSON_Value; Field : String) return JSON_Value;

   --  Element accessors, for array items that are not objects.
   function As_Text (Value : JSON_Value) return Text;
   function As_Integer (Value : JSON_Value) return Integer_Value;
   function As_Float (Value : JSON_Value) return Float_Value;
   function As_Boolean (Value : JSON_Value) return Boolean;

   --  Setters, mirroring the getters.
   procedure Set (Object : JSON_Value; Field : String; Value : Text);
   procedure Set (Object : JSON_Value; Field : String; Value : String);
   procedure Set (Object : JSON_Value; Field : String; Value : Integer_Value);
   procedure Set (Object : JSON_Value; Field : String; Value : Float_Value);
   procedure Set (Object : JSON_Value; Field : String; Value : Boolean);
   procedure Set (Object : JSON_Value; Field : String; Value : JSON_Value);
   procedure Set (Object : JSON_Value; Field : String; Value : JSON_Array);
   procedure Set_Null (Object : JSON_Value; Field : String);

   function New_Object return JSON_Value renames JSON.Create_Object;
   function Null_Value return JSON_Value;

   --  Parse a document, raising ``UARP.Errors.Decoding_Error`` on bad input.
   function Parse (Text_Value : String) return JSON_Value;

   function Serialize (Value : JSON_Value) return String;

end UARP.JSON_Support;
