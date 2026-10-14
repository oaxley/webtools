"""Minimal chat agent for exercising the webtools MCP server.

Connects to an MCP server over Streamable HTTP (FastMCP client), exposes
its tools to an OpenAI-compatible LLM, and runs a simple REPL. Every tool
call and result is printed so the MCP traffic is visible while testing.

File references:
    Type `@/path/to/file` (or `@"path with spaces"`, `~` is expanded) in a
    prompt to attach a local file. The file is loaded into memory on the
    client side; the LLM only sees the `@...` reference and is told to pass
    it verbatim as a tool argument. Right before the MCP call the agent
    substitutes the reference with the file content, so large inputs
    (certificates, tokens, ...) never round-trip through the model.
    Binary files (e.g. DER certificates) are sent base64-encoded.

Prompt history:
    Up/Down browse previously sent prompts (GNU readline line editing, so
    Ctrl-R reverse search works too). History is saved across sessions in
    AGENT_HISTORY_FILE.

Environment:
    OPENAI_API_KEY      required
    OPENAI_MODEL        required
    OPENAI_BASE_URL     optional, defaults to the OpenAI API
    MCP_URL             optional, defaults to http://localhost:8787/mcp
    AGENT_HISTORY_FILE  optional, defaults to ~/.webtools_agent_history
"""

import asyncio
import atexit
import base64
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    # Importing readline is enough for input() to gain line editing and
    # Up/Down history. Not available on Windows: the agent still works,
    # just without history.
    import readline
except ImportError:
    readline = None

from fastmcp import Client
from openai import AsyncOpenAI
from rich.console import Console
from rich.markdown import Markdown

console = Console()

MCP_URL = os.environ.get("MCP_URL", "http://localhost:8787/mcp")
MAX_TOOL_ROUNDS = 5
SYSTEM_PROMPT = (
    "You are a helpful assistant. Use the available tools whenever they "
    "can answer the question; do not guess values a tool can compute.\n"
    "The user may attach local files with references like @/path/to/file. "
    "You cannot see their content. To give a file to a tool, pass the "
    "reference string exactly as written (including the leading @) as the "
    "argument value; the client replaces it with the file content."
)
MAX_FILE_BYTES = 1024 * 1024
HISTORY_FILE = Path(
    os.environ.get("AGENT_HISTORY_FILE", "~/.webtools_agent_history")
).expanduser()
HISTORY_LENGTH = 1000

# `@path` or `@"path with spaces"`, only at the start of the input or after
# whitespace, so e-mail addresses like user@example.com are left alone.
FILE_REF_RE = re.compile(r'(?<!\S)@(?:"([^"]+)"|(\S+))')
TRAILING_PUNCTUATION = ".,;:!?)]}'\""


@dataclass
class Attachment:
    path: Path
    size: int  # size of the file on disk, in bytes
    content: str
    binary: bool  # True when `content` is the base64 encoding of the file


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"error: environment variable {name} is required")
    return value


def setup_history() -> None:
    """Load the persistent prompt history and save it again on exit."""
    if readline is None:
        return
    # We add entries ourselves (see `remember`), so that empty lines,
    # repeats and exit commands don't clutter the history.
    readline.set_auto_history(False)
    readline.set_history_length(HISTORY_LENGTH)
    try:
        readline.read_history_file(HISTORY_FILE)
    except FileNotFoundError:
        pass
    except OSError as e:
        print(f"warning: cannot read history from {HISTORY_FILE}: {e}")

    def save() -> None:
        try:
            readline.write_history_file(HISTORY_FILE)
        except OSError as e:
            print(f"warning: cannot save history to {HISTORY_FILE}: {e}")

    atexit.register(save)


def remember(line: str) -> None:
    """Add a prompt to the history, skipping immediate duplicates."""
    if readline is None:
        return
    length = readline.get_current_history_length()
    if length and readline.get_history_item(length) == line:
        return
    readline.add_history(line)


def load_file(raw_path: str) -> Attachment:
    """Read a referenced file into memory (text, or base64 if binary)."""
    path = Path(raw_path).expanduser()
    if not path.is_file():
        raise ValueError(f"no such file: {path}")
    data = path.read_bytes()
    if len(data) > MAX_FILE_BYTES:
        raise ValueError(f"{path} is larger than {MAX_FILE_BYTES} bytes")
    try:
        return Attachment(path, len(data), data.decode("utf-8"), binary=False)
    except UnicodeDecodeError:
        encoded = base64.b64encode(data).decode("ascii")
        return Attachment(path, len(data), encoded, binary=True)


def attach_files(text: str, attachments: dict[str, Attachment]) -> str:
    """Load every `@file` reference in `text` into `attachments`.

    Returns the user message to send to the LLM: the original text plus a
    short note per attachment (never the content itself). Raises
    ValueError if a referenced file can't be loaded.
    """
    notes = []
    for match in FILE_REF_RE.finditer(text):
        quoted, raw_path = match.group(1), match.group(2)
        if quoted:
            ref, raw_path = match.group(0), quoted
        else:
            # Drop sentence punctuation glued to an unquoted path
            # ("decode @a.pem, then ...") unless it's really part of the name.
            if not Path(raw_path).expanduser().exists():
                raw_path = raw_path.rstrip(TRAILING_PUNCTUATION) or raw_path
            ref = f"@{raw_path}"
        attachment = load_file(raw_path)
        # Re-read on every mention so edits to the file are picked up.
        attachments[ref] = attachment
        kind = "binary, sent base64-encoded" if attachment.binary else "text"
        notes.append(
            f"- {ref} ({attachment.path.name}, {attachment.size} bytes, {kind})"
        )
        console.print(
            f"  attached {attachment.path} ({attachment.size} bytes, {kind})",
            style="dim",
            markup=False,
        )
    if not notes:
        return text
    return (
        f"{text}\n\n[Attached files — pass the reference string as a tool "
        "argument to use the content:\n" + "\n".join(notes) + "]"
    )


def find_reference(value: str, attachments: dict[str, Attachment]) -> str | None:
    """Return the attachment key `value` refers to, if any.

    Tolerates the small rewrites LLMs tend to make when copying a
    reference: a dropped `@`, or added/dropped quotes around the path.
    """
    path = value.strip().removeprefix("@").strip('"')
    for candidate in (value.strip(), f"@{path}", f'@"{path}"'):
        if candidate in attachments:
            return candidate
    return None


def substitute_files(value, attachments: dict[str, Attachment], used: list[str]):
    """Recursively replace `@file` references in tool arguments by content.

    Only string values that are exactly a known reference are replaced, so
    a reference mentioned inside a longer sentence is left untouched.
    """
    if isinstance(value, str):
        ref = find_reference(value, attachments)
        if ref is None:
            return value
        used.append(ref)
        return attachments[ref].content
    if isinstance(value, list):
        return [substitute_files(v, attachments, used) for v in value]
    if isinstance(value, dict):
        return {k: substitute_files(v, attachments, used) for k, v in value.items()}
    return value


def to_openai_tool(tool) -> dict:
    """Convert an MCP tool definition into an OpenAI function tool."""
    # Drop the "$schema" key: some OpenAI-compatible providers reject it.
    parameters = {k: v for k, v in tool.input_schema.items() if k != "$schema"}
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description or "",
            "parameters": parameters,
        },
    }


def result_to_text(result) -> str:
    """Flatten MCP content blocks into a single string for the LLM."""
    parts = [getattr(block, "text", None) or str(block) for block in result.content]
    text = "\n".join(parts)
    return f"ERROR: {text}" if result.is_error else text


async def run_turn(llm, model, mcp, tools, messages, attachments) -> str:
    """Query the LLM, executing tool calls until it gives a final answer."""
    for _ in range(MAX_TOOL_ROUNDS):
        response = await llm.chat.completions.create(
            model=model, messages=messages, tools=tools or None
        )
        message = response.choices[0].message
        messages.append(message.model_dump(exclude_none=True))

        if not message.tool_calls:
            return message.content or ""

        for call in message.tool_calls:
            name = call.function.name
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError as e:
                output = f"ERROR: invalid JSON arguments: {e}"
            else:
                # Log the arguments as the LLM wrote them (with `@file`
                # references), then swap in the file content for the call.
                console.print(f"  -> {name}({json.dumps(args)})", style="dim", markup=False)
                used: list[str] = []
                args = substitute_files(args, attachments, used)
                for ref in used:
                    console.print(
                        f"     {ref} -> {len(attachments[ref].content)} chars from "
                        f"{attachments[ref].path}",
                        style="dim",
                        markup=False,
                    )
                result = await mcp.call_tool(name, args, raise_on_error=False)
                output = result_to_text(result)
            console.print(f"  <- {output}", style="dim", markup=False)
            messages.append(
                {"role": "tool", "tool_call_id": call.id, "content": output}
            )

    return f"(stopped after {MAX_TOOL_ROUNDS} tool rounds without a final answer)"


async def main() -> None:
    api_key = require_env("OPENAI_API_KEY")
    model = require_env("OPENAI_MODEL")
    llm = AsyncOpenAI(api_key=api_key, base_url=os.environ.get("OPENAI_BASE_URL"))

    try:
        async with Client(MCP_URL) as mcp:
            mcp_tools = await mcp.list_tools()
            tools = [to_openai_tool(t) for t in mcp_tools]
            print(f"Connected to {MCP_URL}")
            print(f"Tools: {', '.join(t.name for t in mcp_tools) or '(none)'}")
            print(f"Model: {model}  (type 'exit' or Ctrl-D to quit)\n")

            messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
            # `@file` reference -> loaded file, kept for the whole session so
            # the LLM can reuse a reference in follow-up questions.
            attachments: dict[str, Attachment] = {}
            setup_history()
            while True:
                try:
                    user = (await asyncio.to_thread(input, "you> ")).strip()
                except EOFError:
                    print()
                    break
                if user in {"exit", "quit"}:
                    break
                if not user:
                    continue
                # Recorded before sending, so a prompt that failed (e.g. a
                # mistyped @file path) can be recalled and fixed.
                remember(user)
                try:
                    content = attach_files(user, attachments)
                except (ValueError, OSError) as e:
                    print(f"error: {e}\n")
                    continue
                messages.append({"role": "user", "content": content})
                try:
                    answer = await run_turn(
                        llm, model, mcp, tools, messages, attachments
                    )
                except Exception as e:  # keep the REPL alive on LLM errors
                    print(f"error: {e}\n")
                    continue
                console.print("[bold cyan]agent>[/]")
                console.print(Markdown(answer))
                console.print()
    except (RuntimeError, ConnectionError, OSError) as e:
        # FastMCP wraps transport failures in RuntimeError("Client failed to connect: ...")
        sys.exit(f"error: cannot reach MCP server at {MCP_URL}: {e}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
