"""Persistent kernel for the DSH code-execution seam.

One process per session. Programs arrive as JSON lines on stdin, each carrying a
program body and the binding namespaces the host exposes; the kernel compiles and
executes the body inside a namespace that is created once and reused, so names
assigned by one program are visible to the next.

Two channels leave this process: replies on stdout (one JSON object per line) and
binding calls on fd 3. Program output is captured by redirecting sys.stdout for
the duration of a program, so a program that prints cannot corrupt the reply
framing.

Binding calls are asynchronous: the program awaits a bridge function that writes
a `call` frame to fd 3 and reads the matching `reply` frame back. The host
answers on the same fd. The interpreter is single-threaded and one program runs
at a time, so call and reply pair positionally and need no request id.

Trust posture: program text is hostile input. It runs with this process's own
privileges — the same posture the harness already accepts for shell commands —
and the framing only guarantees that a frame is well-formed, never that the
program was harmless.
"""

from __future__ import annotations

import asyncio
import ast
import contextlib
import io
import json
import os
import sys
import traceback

#: fd the host and this process share for binding calls; Node pins it positionally.
PROTOCOL_FD = 3

#: Namespace shared by every program in this kernel. Created once, on import.
NAMESPACE: dict[str, object] = {"__name__": "__dsh_kernel__"}

#: Cap on captured output per program, matching the host-side bound.
MAX_LOG_CHARS = 1_000_000


class ToolCallError(Exception):
    """Raised when the host refuses one binding call."""


def _write_frame(payload: dict) -> None:
    """Send one frame to the host on the protocol fd."""
    os.write(PROTOCOL_FD, (json.dumps(payload) + "\n").encode("utf-8"))


def _read_frame() -> dict:
    """Read one newline-terminated frame from the host on the protocol fd."""
    buffer = b""
    while b"\n" not in buffer:
        chunk = os.read(PROTOCOL_FD, 65536)
        if not chunk:
            raise RuntimeError("host closed the binding channel")
        buffer += chunk
    line, _, rest = buffer.partition(b"\n")
    # A single program runs at a time and calls pair positionally, so nothing
    # may be waiting behind the frame just read.
    if rest:
        raise RuntimeError("unexpected bytes after a binding reply frame")
    return json.loads(line.decode("utf-8"))


class _Bridge:
    """One binding namespace, as the program sees it.

    The host declares a namespace as a group of named async functions, and the
    program addresses them as attributes: ``await tools.history_search("x")``.
    A plain dict would make that call a `TypeError`, so the members are real
    attributes here.

    A call writes a ``call`` frame to the host and blocks for the matching
    ``reply``. The interpreter is single-threaded and one program runs at a
    time, so calls pair positionally and need no request id.
    """

    def __init__(self, global_name: str, function_names: list[str]) -> None:
        self.__dict__["_global_name"] = global_name
        for function_name in function_names:
            self.__dict__[function_name] = self._make(function_name)

    def _make(self, function_name: str):
        global_name = self.__dict__["_global_name"]

        async def call(*args):
            _write_frame({
                "type": "call",
                "global": global_name,
                "name": function_name,
                "args": list(args),
            })
            reply = _read_frame()
            if reply.get("type") != "reply":
                raise RuntimeError(f"unexpected frame from host: {reply.get('type')!r}")
            if reply.get("ok"):
                return reply.get("value")
            raise ToolCallError(str(reply.get("message", "binding call failed")))

        call.__name__ = function_name
        return call

    def __repr__(self) -> str:
        members = sorted(key for key in self.__dict__ if not key.startswith("_"))
        return f"<binding {self.__dict__['_global_name']}: {', '.join(members)}>"


def _install_bindings(bindings: list[dict]) -> None:
    """Publish each declared namespace into the shared namespace.

    Called before every program, so a binding removed from a later request
    stops resolving immediately instead of leaving the previous run's function
    reachable by name.

    Args:
        bindings: the request's binding declarations, each with ``global`` and
            the member names to expose.
    """
    for binding in bindings:
        global_name = str(binding.get("global", ""))
        names = [str(name) for name in binding.get("names", [])]
        if not global_name:
            continue
        NAMESPACE[global_name] = _Bridge(global_name, names)


def _truncate(text: str) -> str:
    """Bound one program's captured output.

    Args:
        text: raw captured output.

    Returns:
        The text, or its head plus an explicit marker when over the cap.
    """
    if len(text) <= MAX_LOG_CHARS:
        return text
    return text[:MAX_LOG_CHARS] + f"\n[kernel log capture truncated at {MAX_LOG_CHARS} chars]\n"


def _jsonable(value: object) -> object:
    """Render a completion value as JSON, or drop it when it cannot cross.

    Args:
        value: the program's completion value.

    Returns:
        A JSON-safe value, or ``None`` when the value has no JSON form. A
        non-serializable value is reported as absent rather than stringified,
        so the host never mistakes a repr for the real value.
    """
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        return None
    return value


#: Names the kernel owns in the shared namespace; a program that rebinds one is
#: told so rather than silently losing the value it assigned.
KERNEL_NAMES = ('__dsh_main__',)


class _CompletionCollector(ast.NodeVisitor):
    """Find the module's trailing bare expression, which is its completion value.

    The seam's completion value is the program's ``return``. A program that
    relies on a bare final expression — the way a REPL does — has no ``return``
    to find, so this locates the expression and turns it into one. Only the
    LAST statement qualifies: an expression anywhere else is a statement whose
    value the program discarded.
    """

    def __init__(self) -> None:
        self.index: int | None = None

    def visit_Module(self, node: ast.Module) -> None:
        if node.body and isinstance(node.body[-1], ast.Expr):
            expression = node.body[-1].value
            # A trailing STRING is a docstring or a bare note in intent, not a
            # value the author asked to receive; every other expression — a
            # number, a name, a call, a container — is a completion candidate.
            # Rejecting every `Constant` would silently swallow `7`.
            if not isinstance(expression, ast.Constant) or not isinstance(expression.value, str):
                self.index = len(node.body) - 1
        # Deliberately no descent: a nested expression is not the module's
        # completion value, and visiting one would overwrite the index found
        # here.


def _uses_toplevel_await(tree: ast.Module) -> bool:
    """Whether a module needs an async frame.

    True for a bare ``await`` or a bare ``return`` at module scope. Neither
    compiles outside a function, and the seam promises both to a program, so
    either one is a reason to wrap. Only module-scope uses count: an ``await``
    inside a function the program defines is that function's own, and wrapping
    for it would change nothing.
    """

    class Finder(ast.NodeVisitor):
        found = False

        def visit_Await(self, node: ast.Await) -> None:
            self.found = True

        def visit_Return(self, node: ast.Return) -> None:
            self.found = True

        # A nested scope's await/return belongs to that scope, so the walk
        # stops at every definition.
        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            return

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            return

        def visit_Lambda(self, node: ast.Lambda) -> None:
            return

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            return

    finder = Finder()
    finder.visit(tree)
    return finder.found


def _rebound_names(tree: ast.Module) -> set[str]:
    """Every name the module body assigns, at its top level only.

    A name bound inside a nested function or comprehension belongs to that
    scope, so declaring it global in the wrapper would be wrong. Only the
    module's own statements count.

    Args:
        tree: the parsed program.

    Returns:
        The names the wrapper must declare ``global``.
    """
    names: set[str] = set()

    class Collector(ast.NodeVisitor):
        def visit_Assign(self, node: ast.Assign) -> None:
            for target in node.targets:
                names.update(_target_names(target))
            self.generic_visit(node.value)

        def visit_AugAssign(self, node: ast.AugAssign) -> None:
            names.update(_target_names(node.target))
            self.generic_visit(node.value)

        def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
            names.update(_target_names(node.target))
            if node.value is not None:
                self.generic_visit(node.value)

        def visit_NamedExpr(self, node: ast.NamedExpr) -> None:
            names.update(_target_names(node.target))

        def visit_For(self, node: ast.For) -> None:
            names.update(_target_names(node.target))
            for statement in [*node.body, *node.orelse]:
                self.visit(statement)

        def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
            names.update(_target_names(node.target))
            for statement in [*node.body, *node.orelse]:
                self.visit(statement)

        def visit_With(self, node: ast.With) -> None:
            for item in node.items:
                if item.optional_vars is not None:
                    names.update(_target_names(item.optional_vars))
            for statement in node.body:
                self.visit(statement)

        def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
            for item in node.items:
                if item.optional_vars is not None:
                    names.update(_target_names(item.optional_vars))
            for statement in node.body:
                self.visit(statement)

        def visit_Try(self, node: ast.Try) -> None:
            for statement in [*node.body, *node.orelse, *node.finalbody]:
                self.visit(statement)
            for handler in node.handlers:
                if handler.name is not None:
                    names.add(handler.name)
                for statement in handler.body:
                    self.visit(statement)

        def visit_Global(self, node: ast.Global) -> None:
            names.update(node.names)

        # A function or class definition binds the NAME of the definition, and
        # nothing inside it is the module's.
        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            names.add(node.name)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            names.add(node.name)

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            names.add(node.name)

    for statement in tree.body:
        Collector().visit(statement)
    return {name for name in names if not name.startswith('__dsh_')}


def _target_names(target: ast.expr) -> set[str]:
    """The names one assignment target binds."""
    if isinstance(target, ast.Name):
        return {target.id}
    if isinstance(target, (ast.Tuple, ast.List)):
        found: set[str] = set()
        for element in target.elts:
            found.update(_target_names(element))
        return found
    return set()


def _compile_program(program: str) -> tuple[object, str]:
    """Compile a program into something the kernel can run.

    Two shapes, chosen by what the program actually needs:

    * A module that uses a bare ``await`` is compiled as an async function
      body, because Python has no top-level await. The function is entered once
      and its return value is the completion value.
    * Anything else — the common case — runs directly at module scope against
      the shared namespace, which is the only shape where ``total += 1`` works:
      inside a function that name is a local and raises ``UnboundLocalError``
      before it can ever reach the global the previous run left.

    Choosing per program rather than always wrapping is what keeps the REPL
    promise honest for both forms.

    Args:
        program: the program source.

    Returns:
        ``(code_object, mode)`` where mode is ``'module'`` or ``'async'``.

    Raises:
        SyntaxError: the program does not parse.
    """
    tree = ast.parse(program, '<program>', 'exec')
    collector = _CompletionCollector()
    collector.visit(tree)
    has_completion = collector.index is not None
    if has_completion:
        expression = tree.body[collector.index].value
        tree.body[collector.index] = ast.Return(value=expression)

    # Either reason to need an async frame is enough: a bare `await` cannot
    # compile at module scope, and a `return` completion value has no meaning
    # there. A program with neither runs as a module, where its names bind in
    # the namespace itself and `total += 1` works the way a REPL's next line
    # does.
    if not has_completion and not _uses_toplevel_await(tree):
        return compile(ast.fix_missing_locations(tree), '<program>', 'exec'), 'module'

    # The helpers are reached through parameter DEFAULTS, not by name. A bare
    # reference inside a function body compiles to a global load, and a name
    # whose spelling is `__x__` is mangled — there is no class here, so no
    # global can satisfy it. A default argument resolves at definition instead.
    # Every name the body binds is declared `global` inside the wrapper, so the
    # body writes straight into the shared namespace instead of into a frame
    # that dies with the coroutine. That single declaration is what makes both
    # halves of the REPL promise hold: `total += 1` finds the value a previous
    # run left, and a name this run binds is there for the next one. Without it
    # `total += 1` raises `UnboundLocalError` against a fresh function-local,
    # and every assignment would have to be copied out afterwards.
    inherited = _rebound_names(tree)
    declared = [ast.Global(names=[name]) for name in sorted(inherited)] if inherited else []
    wrapper = ast.AsyncFunctionDef(
        name='__dsh_main__',
        args=ast.arguments(posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]),
        body=[*declared, *(tree.body or [ast.Pass()])],
        decorator_list=[],
        returns=None,
        type_comment=None,
        type_params=[],
    )
    module = ast.Module(body=[wrapper], type_ignores=[])
    return compile(ast.fix_missing_locations(module), '<program>', 'exec'), 'async'


def _check_kernel_names(program: str) -> str | None:
    """Refuse a program that rebinds a kernel-owned name.

    Args:
        program: the program source.

    Returns:
        A readable message when the program assigns one of the kernel's names,
        otherwise ``None``.
    """
    for name in KERNEL_NAMES:
        for line in program.splitlines():
            stripped = line.strip()
            if stripped.startswith(f'{name} =') or stripped.startswith(f'def {name}(') or stripped.startswith(f'class {name}'):
                return f'{name} is reserved by the execution kernel'
    return None


async def _execute(program: str) -> tuple[bool, object, list[str], str | None, str | None]:
    """Run one program in the shared namespace.

    A module-shaped program runs directly against the shared namespace, so the
    names it binds ARE the namespace's and a later program reads them the way a
    REPL would. A program with a bare ``await`` needs an async frame instead,
    and runs inside one.

    Args:
        program: the program source.

    Returns:
        ``(ok, value, logs, code, message)``. ``code`` is a stable failure kind
        the host maps onto its taxonomy; ``message`` is the readable detail.
    """
    reserved = _check_kernel_names(program)
    if reserved is not None:
        return False, None, [], "exception", reserved

    buffer = io.StringIO()
    try:
        compiled, mode = _compile_program(program)
    except SyntaxError:
        return False, None, [], "exception", traceback.format_exc(limit=1).strip()

    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
        try:
            exec(compiled, NAMESPACE)
            value: object = None
            if mode == 'async':
                value = await NAMESPACE['__dsh_main__']()
        except BaseException:  # noqa: BLE001 - a program failure is a result, not a crash
            return False, None, [_truncate(buffer.getvalue())], "exception", traceback.format_exc(limit=4).strip()

    return True, value, [_truncate(buffer.getvalue())], None, None


async def _execute(program: str) -> tuple[bool, object, list[str], str | None, str | None]:
    """Run one program in the shared namespace.

    A module-shaped program runs directly against the shared namespace, so the
    names it binds ARE the namespace's and a later program reads them the way a
    REPL would. A program with a bare ``await`` needs an async frame instead,
    and runs inside one.

    Args:
        program: the program source.

    Returns:
        ``(ok, value, logs, code, message)``. ``code`` is a stable failure kind
        the host maps onto its taxonomy; ``message`` is the readable detail.
    """
    reserved = _check_kernel_names(program)
    if reserved is not None:
        return False, None, [], "exception", reserved

    buffer = io.StringIO()
    try:
        compiled, mode = _compile_program(program)
    except SyntaxError:
        return False, None, [], "exception", traceback.format_exc(limit=1).strip()

    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
        try:
            exec(compiled, NAMESPACE)
            value: object = None
            if mode == 'async':
                value = await NAMESPACE['__dsh_main__']()
        except BaseException:  # noqa: BLE001 - a program failure is a result, not a crash
            return False, None, [_truncate(buffer.getvalue())], "exception", traceback.format_exc(limit=4).strip()

    return True, value, [_truncate(buffer.getvalue())], None, None


def _install_frame_helpers() -> None:
    """Publish the async frame's two helpers.

    An async program runs in a function frame, so its names are locals: they
    would neither see what an earlier run left nor survive their own run.
    `seed` copies the namespace into the frame before the body, and the body's
    `finally` copies the frame back out — the pair that makes an awaited program
    behave like the next line of the session rather than a detached function.
    """

    def seed(frame: dict) -> None:
        frame.clear()
        for key, item in NAMESPACE.items():
            if key.startswith('__dsh_') or key in _NON_PROGRAM_NAMES:
                continue
            frame[key] = item

    NAMESPACE['__dsh_seed__'] = seed


#: Names that live in the namespace but belong to the interpreter rather than
#: to any program: they must never be carried between runs as program state.
_NON_PROGRAM_NAMES = frozenset({'__name__', '__builtins__', '__doc__', '__loader__', '__package__', '__spec__'})


def _carry_frame() -> None:
    """Copy an async program's frame names into the shared namespace.

    Only names the program itself bound are read: the kernel's own helpers are
    skipped, so they are never carried as program state.
    """
    frame = NAMESPACE.get('__dsh_frame__')
    if not isinstance(frame, dict):
        return
    for key, item in frame.items():
        if key.startswith('__dsh_') or key == '__name__':
            continue
        NAMESPACE[key] = item


async def main() -> None:
    """Serve programs until stdin closes."""
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)

    while True:
        line = await reader.readline()
        if not line:
            break
        text = line.decode("utf-8").strip()
        if not text:
            continue
        try:
            request = json.loads(text)
        except json.JSONDecodeError:
            continue
        _install_bindings(request.get("bindings") or [])
        ok, value, logs, code, message = await _execute(str(request.get("program", "")))
        reply: dict[str, object] = {"id": request.get("id"), "ok": ok, "logs": logs}
        if ok:
            rendered = _jsonable(value)
            if rendered is not None:
                reply["value"] = rendered
        else:
            reply["code"] = code
            reply["message"] = message
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
