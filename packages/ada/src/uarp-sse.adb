with Ada.Strings.Fixed;

package body UARP.SSE is

   procedure Dispatch
     (Self : in out Parser; Event : out Server_Event; Has_Event : out Boolean);

   procedure Handle_Line (Self : in out Parser; Line : String; Events : in out Event_Vectors.Vector);

   --------------
   -- Dispatch --
   --------------

   procedure Dispatch
     (Self : in out Parser; Event : out Server_Event; Has_Event : out Boolean) is
   begin
      if not Self.Has_Fields then
         Event := (others => <>);
         Has_Event := False;
         return;
      end if;

      Event :=
        (Id        => Self.Id,
         Has_Id    => Self.Has_Id,
         Name      => (if SU.Length (Self.Name) > 0 then Self.Name else +"message"),
         Data      => Self.Data_Lines,
         Retry_Ms  => Self.Retry_Ms,
         Has_Retry => Self.Has_Retry);
      Has_Event := True;

      --  `id` persists across frames per the SSE specification; everything else
      --  resets.
      Self.Data_Lines := Empty_Text;
      Self.Has_Data := False;
      Self.Name := Empty_Text;
      Self.Retry_Ms := 0;
      Self.Has_Retry := False;
      Self.Has_Fields := False;
   end Dispatch;

   -----------------
   -- Handle_Line --
   -----------------

   procedure Handle_Line
     (Self : in out Parser; Line : String; Events : in out Event_Vectors.Vector)
   is
      Event     : Server_Event;
      Has_Event : Boolean;
   begin
      if Line'Length = 0 then
         Dispatch (Self, Event, Has_Event);
         if Has_Event then
            Events.Append (Event);
         end if;
         return;
      end if;

      --  A line starting with a colon is a comment (keep-alive).
      if Line (Line'First) = ':' then
         return;
      end if;

      declare
         Colon : constant Natural := Ada.Strings.Fixed.Index (Line, ":");
         Field : constant String :=
           (if Colon = 0 then Line else Line (Line'First .. Colon - 1));
         Raw   : constant String :=
           (if Colon = 0 then "" else Line (Colon + 1 .. Line'Last));
         Value : constant String :=
           (if Raw'Length > 0 and then Raw (Raw'First) = ' '
            then Raw (Raw'First + 1 .. Raw'Last)
            else Raw);
      begin
         Self.Has_Fields := True;
         if Field = "event" then
            Self.Name := +Value;
         elsif Field = "data" then
            if Self.Has_Data then
               SU.Append (Self.Data_Lines, ASCII.LF);
            end if;
            SU.Append (Self.Data_Lines, Value);
            Self.Has_Data := True;
         elsif Field = "id" then
            if Ada.Strings.Fixed.Index (Value, "" & ASCII.NUL) = 0 then
               Self.Id := +Value;
               Self.Has_Id := True;
            end if;
         elsif Field = "retry" then
            begin
               Self.Retry_Ms := Natural'Value (Value);
               Self.Has_Retry := True;
            exception
               when Constraint_Error =>
                  null; --  A malformed retry hint is simply ignored.
            end;
         end if;
         --  Unknown fields are ignored, as the specification requires.
      end;
   end Handle_Line;

   ----------
   -- Feed --
   ----------

   procedure Feed
     (Self   : in out Parser;
      Chunk  : String;
      Events : in out Event_Vectors.Vector) is
   begin
      SU.Append (Self.Buffer, Chunk);

      loop
         declare
            Buffer : constant String := +Self.Buffer;
            Break  : constant Natural :=
              Ada.Strings.Fixed.Index (Buffer, "" & ASCII.LF);
            Last   : Natural;
         begin
            exit when Break = 0;
            Last := Break - 1;
            if Last >= Buffer'First and then Buffer (Last) = ASCII.CR then
               Last := Last - 1;
            end if;
            Handle_Line (Self, Buffer (Buffer'First .. Last), Events);
            Self.Buffer := +Buffer (Break + 1 .. Buffer'Last);
         end;
      end loop;
   end Feed;

   -----------
   -- Reset --
   -----------

   procedure Reset (Self : in out Parser) is
   begin
      Self.Buffer := Empty_Text;
      Self.Data_Lines := Empty_Text;
      Self.Has_Data := False;
      Self.Name := Empty_Text;
      Self.Retry_Ms := 0;
      Self.Has_Retry := False;
      Self.Has_Fields := False;
      --  `Id` deliberately survives: the specification says it persists across
      --  frames, and it is what a reconnect replays.
   end Reset;

   ------------
   -- Finish --
   ------------

   procedure Finish
     (Self      : in out Parser;
      Event     : out Server_Event;
      Has_Event : out Boolean)
   is
      Pending : Event_Vectors.Vector;
   begin
      if SU.Length (Self.Buffer) > 0 then
         declare
            Remainder : constant String := +Self.Buffer;
         begin
            Self.Buffer := Empty_Text;
            Handle_Line (Self, Remainder, Pending);
         end;
      end if;

      if not Pending.Is_Empty then
         Event := Pending.First_Element;
         Has_Event := True;
         return;
      end if;
      Dispatch (Self, Event, Has_Event);
   end Finish;

end UARP.SSE;
