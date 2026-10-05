--  `application/x-www-form-urlencoded` request bodies.
--
--  Encoded exactly the way the WHATWG URL standard's urlencoded serializer
--  does -- the one `URLSearchParams` uses -- so every SDK puts the same bytes
--  on the wire for the same fields. Each Character of a name or value is one
--  byte of its UTF-8 text.

with UARP.Types;

package UARP.Form is

   --  The value for the `Content-Type` header, exactly.
   Content_Type : constant String := "application/x-www-form-urlencoded";

   --  Escape one name or value: `A-Z a-z 0-9 * - . _` stay as they are, a
   --  space becomes `+`, and every other byte becomes `%XX` in upper-case hex.
   --  `~` is escaped too, which RFC 3986 would leave alone and this
   --  serializer does not -- so this is not `UARP.Types.Encode_Query`.
   function Encode_Component (Value : String) return String;

   --  `name=value` for every pair, in the order given, joined by `&`. A field
   --  the caller left unset is simply not in the vector; nothing is skipped
   --  or reordered here.
   function Encode (Fields : UARP.Types.Pair_Vectors.Vector) return String;

end UARP.Form;
