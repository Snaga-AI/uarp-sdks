with Ada.Strings.Fixed;

package body UARP.SSE is

   procedure Dispatch
     (Self : in out Parser; Event : out Server_Event; Has_Event : out Boolean);

   procedure Handle_Line (Self : in out Parser; Line : String; Events : in out Event_Vectors.Vector);

   function Inline_Event (Body_Text : String) return Server_Event;

   -------------------
   -- Extract_Field --
   -------------------

   function Extract_Field (JSON : String; Field : String) return Optional_Text is
      Needle     : constant String := """" & Field & """";
      Start_Pos  : constant Natural := Ada.Strings.Fixed.Index (JSON, Needle);
      I          : Natural;
      Value_Start : Natural;
   begin
      if Start_Pos = 0 then
         return (Value => Empty_Text, Has_Value => False);
      end if;

      --  Skip `:` and spaces after the field name.
      I := Start_Pos + Needle'Length;
      while I <= JSON'Last and then (JSON (I) = ':' or else JSON (I) = ' ') loop
         I := I + 1;
      end loop;

      if I > JSON'Last or else JSON (I) /= '"' then
         return (Value => Empty_Text, Has_Value => False);
      end if;

      --  Read the quoted string, honouring `\` escapes so a `"` inside a
      --  value can't fool the scanner.
      I := I + 1;
      Value_Start := I;
      while I <= JSON'Last loop
         if JSON (I) = '\' then
            I := I + 1;
            exit when I > JSON'Last;
            I := I + 1;
         elsif JSON (I) = '"' then
            exit;
         else
            I := I + 1;
         end if;
      end loop;

      if I <= JSON'Last and then JSON (I) = '"' then
         if I > Value_Start then
            return (Value => +JSON (Value_Start .. I - 1), Has_Value => True);
         end if;
         return (Value => Empty_Text, Has_Value => False);
      end if;

      --  Unterminated string; take what we have.
      if JSON'Last >= Value_Start then
         return (Value => +JSON (Value_Start .. JSON'Last), Has_Value => True);
      end if;
      return (Value => Empty_Text, Has_Value => False);
   end Extract_Field;

   -----------------------
   -- Extract_Event_Type --
   -----------------------

   function Extract_Event_Type (JSON : String) return Optional_Text is
     (Extract_Field (JSON, "type"));

   --------------
   -- Dispatch --
   --------------

   procedure Dispatch
     (Self : in out Parser; Event : out Server_Event; Has_Event : out Boolean) is
   begin
      --  A frame with no `data:` line is not a deliverable event: an
      --  `id:`/`retry:`-only frame updates state but carries nothing to emit.
      if not Self.Has_Data then
         Event := (others => <>);
         Has_Event := False;
         Self.Data_Lines := Empty_Text;
         Self.Has_Data := False;
         Self.Name := Empty_Text;
         Self.Id := Empty_Text;
         Self.Has_Id := False;
         Self.Retry_Ms := 0;
         Self.Has_Retry := False;
         Self.Has_Fields := False;
         return;
      end if;

      declare
         Joined : constant String := +Self.Data_Lines;
      begin
         if Joined'Length = 0 then
            Event := (others => <>);
            Has_Event := False;
            Self.Data_Lines := Empty_Text;
            Self.Has_Data := False;
            Self.Name := Empty_Text;
            Self.Id := Empty_Text;
            Self.Has_Id := False;
            Self.Retry_Ms := 0;
            Self.Has_Retry := False;
            Self.Has_Fields := False;
            return;
         end if;

         --  Event name: the `event:` field if set, else the `type` inside a
         --  JSON payload, else "message".
         declare
            Event_Type : constant Optional_Text := Extract_Event_Type (Joined);
            Resolved   : Text;
         begin
            if SU.Length (Self.Name) > 0 then
               Resolved := Self.Name;
            elsif Event_Type.Has_Value then
               Resolved := Event_Type.Value;
            else
               Resolved := +"message";
            end if;

            Event :=
              (Id        => Self.Id,
               Has_Id    => Self.Has_Id,
               Name      => Resolved,
               Data      => Self.Data_Lines,
               Retry_Ms  => Self.Retry_Ms,
               Has_Retry => Self.Has_Retry);
            Has_Event := True;
         end;
      end;

      --  Reset everything, including `Id` — it is per-frame, not persisted
      --  across frames.  The flow captures the emitted id for replay before
      --  this runs, so reconnect still resumes from the last event id.
      Self.Data_Lines := Empty_Text;
      Self.Has_Data := False;
      Self.Name := Empty_Text;
      Self.Id := Empty_Text;
      Self.Has_Id := False;
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

      --  Bare NDJSON line — a self-contained frame with no field prefix.
      --  Check BEFORE the `:` branch, since a JSON object starts with `{`.
      if Line (Line'First) = '{' then
         Events.Append (Inline_Event (Line));
         return;
      end if;

      --  SSE comment.  The platform also carries a JSON payload in a comment
      --  (`:{"type":"…","event_id":"…"}`); that is a self-contained frame.
      --  A bare comment is a keep-alive.
      if Line (Line'First) = ':' then
         declare
            Body_Text : constant String :=
              Ada.Strings.Fixed.Trim
                (Line (Line'First + 1 .. Line'Last), Ada.Strings.Both);
         begin
            if Body_Text'Length > 0 and then Body_Text (Body_Text'First) = '{' then
               Events.Append (Inline_Event (Body_Text));
            end if;
         end;
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
            if Value = "[DONE]" then
               Self.Done := True;
               --  Flush a pending event, if any; `[DONE]` itself carries no
               --  payload.
               if Self.Has_Data
                 or else SU.Length (Self.Name) > 0
                 or else Self.Has_Id
               then
                  Dispatch (Self, Event, Has_Event);
                  if Has_Event then
                     Events.Append (Event);
                  end if;
               end if;
               return;
            end if;
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

   ------------------
   -- Inline_Event --
   ------------------

   function Inline_Event (Body_Text : String) return Server_Event is
      Event_Id   : constant Optional_Text := Extract_Field (Body_Text, "event_id");
      Event_Name : constant Optional_Text := Extract_Event_Type (Body_Text);
   begin
      return
        (Id        => (if Event_Id.Has_Value then Event_Id.Value else Empty_Text),
         Has_Id    => Event_Id.Has_Value,
         Name      => (if Event_Name.Has_Value then Event_Name.Value else +"message"),
         Data      => +Body_Text,
         Retry_Ms  => 0,
         Has_Retry => False);
   end Inline_Event;

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
      Self.Id := Empty_Text;
      Self.Has_Id := False;
      Self.Retry_Ms := 0;
      Self.Has_Retry := False;
      Self.Has_Fields := False;
      Self.Done := False;
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

   -------------
   -- Is_Done --
   -------------

   function Is_Done (Self : Parser) return Boolean is (Self.Done);

end UARP.SSE;