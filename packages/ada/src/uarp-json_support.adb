with UARP.Errors;

package body UARP.JSON_Support is

   use type JSON.JSON_Value_Type;

   -------------
   -- Present --
   -------------

   function Present (Value : JSON_Value; Field : String) return Boolean is
   begin
      if JSON.Kind (Value) /= JSON.JSON_Object_Type then
         return False;
      end if;
      if not JSON.Has_Field (Value, Field) then
         return False;
      end if;
      return JSON.Kind (JSON.Get (Value, Field)) /= JSON.JSON_Null_Type;
   end Present;

   ---------------
   -- Get_Value --
   ---------------

   function Get_Value (Value : JSON_Value; Field : String) return JSON_Value is
   begin
      if Present (Value, Field) then
         return JSON.Get (Value, Field);
      end if;
      return Null_Value;
   end Get_Value;

   -------------
   -- Getters --
   -------------

   function Get_Text (Value : JSON_Value; Field : String) return Text is
     (As_Text (Get_Value (Value, Field)));

   function Get_Integer (Value : JSON_Value; Field : String) return Integer_Value is
     (As_Integer (Get_Value (Value, Field)));

   function Get_Float (Value : JSON_Value; Field : String) return Float_Value is
     (As_Float (Get_Value (Value, Field)));

   function Get_Boolean (Value : JSON_Value; Field : String) return Boolean is
     (As_Boolean (Get_Value (Value, Field)));

   function Get_Array (Value : JSON_Value; Field : String) return JSON_Array is
      Item : constant JSON_Value := Get_Value (Value, Field);
   begin
      if JSON.Kind (Item) = JSON.JSON_Array_Type then
         return JSON.Get (Item);
      end if;
      return JSON.Empty_Array;
   end Get_Array;

   -------------
   -- As_Text --
   -------------

   function As_Text (Value : JSON_Value) return Text is
   begin
      case JSON.Kind (Value) is
         when JSON.JSON_String_Type =>
            return +String'(JSON.Get (Value));
         when JSON.JSON_Null_Type =>
            return Empty_Text;
         when others =>
            --  Numbers and booleans reach here when a field changed shape;
            --  their textual form is more useful than an exception.
            return +JSON.Write (Value);
      end case;
   end As_Text;

   ----------------
   -- As_Integer --
   ----------------

   function As_Integer (Value : JSON_Value) return Integer_Value is
   begin
      case JSON.Kind (Value) is
         when JSON.JSON_Int_Type =>
            return JSON.Get (Value);
         when JSON.JSON_Float_Type =>
            return Integer_Value (Float_Value'(JSON.Get_Long_Float (Value)));
         when others =>
            return 0;
      end case;
   end As_Integer;

   --------------
   -- As_Float --
   --------------

   function As_Float (Value : JSON_Value) return Float_Value is
   begin
      case JSON.Kind (Value) is
         when JSON.JSON_Float_Type =>
            return JSON.Get_Long_Float (Value);
         when JSON.JSON_Int_Type =>
            return Float_Value (Integer_Value'(JSON.Get (Value)));
         when others =>
            return 0.0;
      end case;
   end As_Float;

   ----------------
   -- As_Boolean --
   ----------------

   function As_Boolean (Value : JSON_Value) return Boolean is
   begin
      if JSON.Kind (Value) = JSON.JSON_Boolean_Type then
         return JSON.Get (Value);
      end if;
      return False;
   end As_Boolean;

   -------------
   -- Setters --
   -------------

   procedure Set (Object : JSON_Value; Field : String; Value : Text) is
   begin
      JSON.Set_Field (Object, Field, +Value);
   end Set;

   procedure Set (Object : JSON_Value; Field : String; Value : String) is
   begin
      JSON.Set_Field (Object, Field, Value);
   end Set;

   procedure Set (Object : JSON_Value; Field : String; Value : Integer_Value) is
   begin
      JSON.Set_Field (Object, Field, JSON.Create (Value));
   end Set;

   procedure Set (Object : JSON_Value; Field : String; Value : Float_Value) is
   begin
      JSON.Set_Field_Long_Float (Object, Field, Value);
   end Set;

   procedure Set (Object : JSON_Value; Field : String; Value : Boolean) is
   begin
      JSON.Set_Field (Object, Field, Value);
   end Set;

   procedure Set (Object : JSON_Value; Field : String; Value : JSON_Value) is
   begin
      JSON.Set_Field (Object, Field, Value);
   end Set;

   procedure Set (Object : JSON_Value; Field : String; Value : JSON_Array) is
   begin
      JSON.Set_Field (Object, Field, Value);
   end Set;

   procedure Set_Null (Object : JSON_Value; Field : String) is
   begin
      JSON.Set_Field (Object, Field, JSON.Create);
   end Set_Null;

   ----------------
   -- Null_Value --
   ----------------

   function Null_Value return JSON_Value is (JSON.Create);

   -----------
   -- Parse --
   -----------

   function Parse (Text_Value : String) return JSON_Value is
      Result : constant JSON.Read_Result := JSON.Read (Text_Value);
   begin
      if Result.Success then
         return Result.Value;
      end if;
      raise UARP.Errors.Decoding_Error
        with JSON.Format_Parsing_Error (Result.Error);
   end Parse;

   ---------------
   -- Serialize --
   ---------------

   function Serialize (Value : JSON_Value) return String is
     (JSON.Write (Value, Compact => True));

end UARP.JSON_Support;
