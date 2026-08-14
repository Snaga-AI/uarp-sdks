with Ada.Characters.Handling;
with Ada.Strings.Fixed;

package body UARP.Types is

   Hex : constant String := "0123456789ABCDEF";

   function Is_Unreserved (Item : Character) return Boolean is
     (Item in 'A' .. 'Z' | 'a' .. 'z' | '0' .. '9' | '-' | '.' | '_' | '~');

   ---------
   -- Add --
   ---------

   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : String) is
   begin
      Into.Append (Pair'(Name => +Name, Value => +Value));
   end Add;

   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : Text) is
   begin
      Into.Append (Pair'(Name => +Name, Value => Value));
   end Add;

   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : Integer_Value) is
   begin
      Add (Into, Name, Ada.Strings.Fixed.Trim (Integer_Value'Image (Value), Ada.Strings.Both));
   end Add;

   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : Float_Value) is
   begin
      Add (Into, Name, Ada.Strings.Fixed.Trim (Float_Value'Image (Value), Ada.Strings.Both));
   end Add;

   procedure Add (Into : in out Pair_Vectors.Vector; Name : String; Value : Boolean) is
   begin
      Add (Into, Name, (if Value then "true" else "false"));
   end Add;

   ------------
   -- Lookup --
   ------------

   function Lookup (List : Pair_Vectors.Vector; Name : String) return String is
      Wanted : constant String := Ada.Characters.Handling.To_Lower (Name);
   begin
      for Item of List loop
         if Ada.Characters.Handling.To_Lower (+Item.Name) = Wanted then
            return +Item.Value;
         end if;
      end loop;
      return "";
   end Lookup;

   -------------------------
   -- Encode_Path_Segment --
   -------------------------

   function Encode_Path_Segment (Value : String) return String is
      Result : String (1 .. Value'Length * 3);
      Last   : Natural := 0;
   begin
      for Item of Value loop
         if Is_Unreserved (Item) then
            Last := Last + 1;
            Result (Last) := Item;
         else
            Result (Last + 1) := '%';
            Result (Last + 2) := Hex (Character'Pos (Item) / 16 + 1);
            Result (Last + 3) := Hex (Character'Pos (Item) mod 16 + 1);
            Last := Last + 3;
         end if;
      end loop;
      return Result (1 .. Last);
   end Encode_Path_Segment;

   ------------------
   -- Encode_Query --
   ------------------

   function Encode_Query (Value : String) return String is
      Result : String (1 .. Value'Length * 3);
      Last   : Natural := 0;
   begin
      for Item of Value loop
         --  A space is written as %20 rather than `+`: `+` means space only
         --  under form-encoding rules, %20 means it everywhere.
         if Is_Unreserved (Item) then
            Last := Last + 1;
            Result (Last) := Item;
         else
            Result (Last + 1) := '%';
            Result (Last + 2) := Hex (Character'Pos (Item) / 16 + 1);
            Result (Last + 3) := Hex (Character'Pos (Item) mod 16 + 1);
            Last := Last + 3;
         end if;
      end loop;
      return Result (1 .. Last);
   end Encode_Query;

   -----------------
   -- Build_Query --
   -----------------

   function Build_Query (Parameters : Pair_Vectors.Vector) return String is
      Buffer : Text := Empty_Text;
      First  : Boolean := True;
   begin
      for Item of Parameters loop
         SU.Append (Buffer, (if First then "?" else "&"));
         First := False;
         SU.Append (Buffer, Encode_Query (+Item.Name));
         SU.Append (Buffer, "=");
         SU.Append (Buffer, Encode_Query (+Item.Value));
      end loop;
      return +Buffer;
   end Build_Query;

   --------------
   -- Join_URL --
   --------------

   function Join_URL (Base : String; Path : String) return String is
      Base_Last : Natural := Base'Last;
      Path_First : Positive := Path'First;
   begin
      while Base_Last >= Base'First and then Base (Base_Last) = '/' loop
         Base_Last := Base_Last - 1;
      end loop;
      while Path_First <= Path'Last and then Path (Path_First) = '/' loop
         Path_First := Path_First + 1;
      end loop;
      return Base (Base'First .. Base_Last) & "/" & Path (Path_First .. Path'Last);
   end Join_URL;

end UARP.Types;
