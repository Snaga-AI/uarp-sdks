package body Stream_Collector is

   package SU renames Ada.Strings.Unbounded;

   ------------
   -- Handle --
   ------------

   overriding procedure Handle
     (Self     : in out Collector;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean)
   is
      Name : constant String := SU.To_String (Event.Name);
   begin
      Self.Seen := Self.Seen + 1;
      if SU.Length (Self.Order) > 0 then
         SU.Append (Self.Order, ",");
      end if;
      SU.Append (Self.Order, Name);
      --  Stop as soon as the run finishes, exactly as a caller would.
      Continue := Name /= "run.completed";
   end Handle;

   -----------
   -- Count --
   -----------

   function Count (Self : Collector) return Natural is (Self.Seen);

   -----------
   -- Names --
   -----------

   function Names (Self : Collector) return String is (SU.To_String (Self.Order));

   -----------------
   -- All_Collector --
   -----------------

   overriding procedure Handle
     (Self     : in out All_Collector;
      Event    : UARP.SSE.Server_Event;
      Continue : in out Boolean)
   is
      Name : constant String := SU.To_String (Event.Name);
   begin
      Self.Seen := Self.Seen + 1;
      if SU.Length (Self.Order) > 0 then
         SU.Append (Self.Order, ",");
      end if;
      SU.Append (Self.Order, Name);
      --  Never stop: the terminal-event set or [DONE] handles it.
      Continue := True;
   end Handle;

   function All_Count (Self : All_Collector) return Natural is (Self.Seen);

   function All_Names (Self : All_Collector) return String is (SU.To_String (Self.Order));

end Stream_Collector;