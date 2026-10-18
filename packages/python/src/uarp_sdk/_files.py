"""Files for the multipart endpoints."""

from __future__ import annotations

import dataclasses
import os
from typing import Optional, Union


@dataclasses.dataclass
class FilePart:
    """A file to upload: its bytes, the filename advertised for it, and its type."""

    data: bytes
    filename: str = "file"
    #: MIME type; `application/octet-stream` when not given.
    content_type: Optional[str] = None

    @classmethod
    def from_path(cls, path: Union[str, "os.PathLike[str]"], content_type: Optional[str] = None) -> "FilePart":
        """Read a file from disk, using its name as the part's filename."""
        with open(path, "rb") as handle:
            data = handle.read()
        return cls(data=data, filename=os.path.basename(os.fspath(path)) or "file", content_type=content_type)
