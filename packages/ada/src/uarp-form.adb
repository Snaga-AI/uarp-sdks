package body UARP.Form is

   use UARP.Types;

   Hex : constant String := "0123456789ABCDEF";

   --  The bytes the urlencoded serializer leaves as they are.
   function Is_Kept (Item : Character) return Boolean is
     (Item in 'A' .. 'Z' | 'a' .. 'z' | '0' .. '9' | '*' | '-' | '.' | '_');

   ----------------------
   -- Encode_Component --
   ----------------------

   function Encode_Component (Value : String) return String is
      Result : String (1 .. Value'Length * 3);
      Last   : Natural := 0;
   begin
      for Item of Value loop
         if Is_Kept (Item) then
            Last := Last + 1;
            Result (Last) := Item;
         elsif Item = ' ' then
            Last := Last + 1;
            Result (Last) := '+';
         else
            Result (Last + 1) := '%';
            Result (Last + 2) := Hex (Character'Pos (Item) / 16 + 1);
            Result (Last + 3) := Hex (Character'Pos (Item) mod 16 + 1);
            Last := Last + 3;
         end if;
      end loop;
      return Result (1 .. Last);
   end Encode_Component;

   ------------
   -- Encode --
   ------------

   function Encode (Fields : UARP.Types.Pair_Vectors.Vector) return String is
      Buffer : Text := Empty_Text;
      First  : Boolean := True;
   begin
      for Item of Fields loop
         if not First then
            SU.Append (Buffer, "&");
         end if;
         First := False;
         SU.Append (Buffer, Encode_Component (+Item.Name));
         SU.Append (Buffer, "=");
         SU.Append (Buffer, Encode_Component (+Item.Value));
      end loop;
      return +Buffer;
   end Encode;

end UARP.Form;
