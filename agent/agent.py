"""Minimal chat agent for exercising the webtools MCP server.

Connects to an MCP server over Streamable HTTP (FastMCP client), exposes
its tools to an OpenAI-compatible LLM, and runs a simple REPL. Every tool
call and result is printed so the MCP traffic is visible while testing.

Environment:
    OPENAI_API_KEY   required
    OPENAI_MODEL     required
    OPENAI_BASE_URL  optional, defaults to the OpenAI API
    MCP_URL          optional, defaults to http://localhost:8787/mcp
"""

import asyncio
import json
import os
import sys

from fastmcp import Client
from openai import AsyncOpenAI
from rich.console import Console
from rich.markdown import Markdown

console = Console()

MCP_URL = os.environ.get("MCP_URL", "http://localhost:8787/mcp")
MAX_TOOL_ROUNDS = 5
SYSTEM_PROMPT = (
    "You are a helpful assistant. Use the available tools whenever they "
    "can answer the question; do not guess values a tool can compute."
)


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"error: environment variable {name} is required")
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


async def run_turn(llm, model, mcp, tools, messages) -> str:
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
                console.print(f"  -> {name}({json.dumps(args)})", style="dim", markup=False)
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
                messages.append({"role": "user", "content": user})
                try:
                    answer = await run_turn(llm, model, mcp, tools, messages)
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
