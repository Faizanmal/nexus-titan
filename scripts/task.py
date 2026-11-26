"""Cross-platform developer tasks. Destructive demo reset is explicitly scoped."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def resolve_executable(command: str) -> str:
    """Find command in PATH or standard user directories like ~/.local/bin."""
    resolved = shutil.which(command)
    if resolved:
        return resolved
    if command == "uv":
        candidate = (
            Path.home()
            / ".local"
            / "bin"
            / ("uv.exe" if sys.platform == "win32" else "uv")
        )
        if candidate.is_file():
            return str(candidate)
    return command


def task_environment() -> dict[str, str]:
    """Load simple KEY=VALUE entries without overriding the caller's environment."""
    environment = os.environ.copy()
    env_file = ROOT / ".env"
    if env_file.exists():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in environment:
                environment[key] = value
    return environment


def run(*args: str, env: dict[str, str] | None = None) -> None:
    cmd = list(args)
    if cmd:
        cmd[0] = resolve_executable(cmd[0])
    try:
        result = subprocess.run(cmd, cwd=ROOT, env=env, check=False)
    except OSError as error:
        raise SystemExit(f"Could not start {cmd[0]}: {error}") from None
    if result.returncode:
        raise SystemExit(result.returncode)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "task",
        choices=[
            "setup",
            "dev",
            "migrate",
            "seed",
            "identity-seed",
            "projection-rebuild",
            "world-seed",
            "telemetry-simulate",
            "telemetry-prune",
            "graph-rebuild",
            "graph-verify",
            "fixture-run",
            "fixture-reset",
            "test",
            "smoke",
            "reset-demo",
            "integration",
            "compose-check",
        ],
    )
    parser.add_argument("target", nargs="?", default="web")
    parser.add_argument("--tenant", default="")
    parser.add_argument("--confirm", default="")
    parser.add_argument("--site", default="titan-wtp-01")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--seed", type=int, default=20261115)
    parser.add_argument("--steps", type=int, default=240)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--throttle-ms", type=int, default=0)
    parser.add_argument("--retention-days", type=int, default=90)
    args = parser.parse_args()
    if args.task == "setup":
        run("pnpm", "install", "--frozen-lockfile")
        run("uv", "sync", "--project", "services/api")
    elif args.task == "dev":
        if args.target in {"web", "api"}:
            if args.target == "web":
                run("pnpm", "--filter", "@nexus-titan/web", "dev")
            else:
                run(
                    "uv",
                    "run",
                    "--project",
                    "services/api",
                    "uvicorn",
                    "nexus_titan_api.main:app",
                    "--app-dir",
                    "services/api/src",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                    "--reload",
                    env=task_environment(),
                )
        elif args.target in {"core", "distributed", "graph", "observe"}:
            run(
                "docker", "compose", "--profile", args.target, "up", "--build", "--wait"
            )
        else:
            raise SystemExit("target: web|api|core|distributed|graph|observe")
    elif args.task == "migrate":
        run("docker", "compose", "--profile", "core", "run", "--rm", "migrate")
    elif args.task == "seed":
        run(
            "docker",
            "compose",
            "--profile",
            "core",
            "run",
            "--rm",
            "api",
            "python",
            "-m",
            "nexus_titan_api.seed",
        )
    elif args.task == "identity-seed":
        environment = task_environment()
        source_path = str(ROOT / "services" / "api" / "src")
        environment["PYTHONPATH"] = os.pathsep.join(
            filter(None, [source_path, environment.get("PYTHONPATH", "")])
        )
        run(
            "uv",
            "run",
            "--project",
            "services/api",
            "python",
            "-m",
            "nexus_titan_api.identity_seed",
            env=environment,
        )
    elif args.task == "projection-rebuild":
        if not args.tenant or args.confirm != args.tenant:
            raise SystemExit(
                "Projection rebuild requires --tenant TENANT --confirm TENANT"
            )
        environment = task_environment()
        source_path = str(ROOT / "services" / "api" / "src")
        environment["PYTHONPATH"] = os.pathsep.join(
            filter(None, [source_path, environment.get("PYTHONPATH", "")])
        )
        run(
            "uv",
            "run",
            "--project",
            "services/api",
            "python",
            "-m",
            "nexus_titan_api.projection_rebuild",
            "--tenant",
            args.tenant,
            "--confirm",
            args.confirm,
            env=environment,
        )
    elif args.task == "world-seed":
        run(
            "docker",
            "compose",
            "--profile",
            "core",
            "run",
            "--rm",
            "api",
            "python",
            "-m",
            "nexus_titan_api.world_seed",
        )
    elif args.task in {"telemetry-simulate", "telemetry-prune"}:
        if args.tenant != "demo-nexus" or args.confirm != args.tenant:
            raise SystemExit(
                "Synthetic telemetry requires --tenant demo-nexus --confirm demo-nexus"
            )
        command = [
            "docker",
            "compose",
            "--profile",
            "core",
            "run",
            "--rm",
            "api",
            "python",
            "-m",
            "nexus_titan_api.telemetry_store",
            "--tenant",
            args.tenant,
            "--confirm",
            args.confirm,
        ]
        if args.task == "telemetry-prune":
            command.extend(["--prune", "--retention-days", str(args.retention_days)])
        else:
            command.extend(
                [
                    "--seed",
                    str(args.seed),
                    "--steps",
                    str(args.steps),
                    "--batch-size",
                    str(args.batch_size),
                    "--throttle-ms",
                    str(args.throttle_ms),
                ]
            )
        run(*command)
    elif args.task in {"graph-rebuild", "graph-verify"}:
        if not args.tenant or args.confirm != args.tenant:
            raise SystemExit(
                "Graph operation requires --tenant TENANT --confirm TENANT"
            )
        environment = task_environment()
        source_path = str(ROOT / "services" / "api" / "src")
        environment["PYTHONPATH"] = os.pathsep.join(
            filter(None, [source_path, environment.get("PYTHONPATH", "")])
        )
        command = [
            "uv",
            "run",
            "--project",
            "services/api",
            "python",
            "-m",
            "nexus_titan_api.world_graph",
        ]
        if args.task == "graph-verify":
            command.append("--verify")
        command.extend(
            ["--tenant", args.tenant, "--site", args.site, "--confirm", args.confirm]
        )
        run(*command, env=environment)
    elif args.task == "fixture-run":
        if not args.run_id:
            raise SystemExit("Fixture run requires --run-id UUIDv4")
        run(
            sys.executable,
            str(ROOT / "scripts/world-run-fixture.py"),
            "create",
            "--run-id",
            args.run_id,
        )
    elif args.task == "fixture-reset":
        if not args.run_id or args.confirm != args.run_id:
            raise SystemExit("Fixture reset requires --run-id UUIDv4 --confirm UUIDv4")
        run(
            sys.executable,
            str(ROOT / "scripts/world-run-fixture.py"),
            "reset",
            "--run-id",
            args.run_id,
            "--confirm",
            args.confirm,
        )
    elif args.task == "test":
        run("pnpm", "-r", "lint")
        run("pnpm", "-r", "typecheck")
        run("pnpm", "-r", "test")
        run("pnpm", "firebase:check")
        run("uv", "run", "--project", "services/api", "pytest")
    elif args.task == "smoke":
        base = os.getenv("NEXT_PUBLIC_API_URL", "http://127.0.0.1:8000")
        for path in ("/health", "/health/ready"):
            with urllib.request.urlopen(base + path, timeout=5) as response:
                print(f"{path}: HTTP {response.status} {response.read().decode()}")
                if response.status != 200:
                    raise SystemExit(1)
    elif args.task == "reset-demo":
        if args.tenant != "demo-nexus" or args.confirm != "demo-nexus":
            raise SystemExit("Refused. Supply --tenant demo-nexus --confirm demo-nexus")
        run(
            "docker",
            "compose",
            "--profile",
            "core",
            "run",
            "--rm",
            "api",
            "python",
            "-m",
            "nexus_titan_api.reset_demo",
            "--tenant",
            args.tenant,
            "--confirm",
            args.confirm,
        )
    elif args.task == "integration":
        run("docker", "compose", "--profile", args.target, "up", "--build", "--wait")
        run("docker", "compose", "--profile", "core", "run", "--rm", "migrate")
        run("docker", "compose", "--profile", "core", "run", "--rm", "migrate")
        run(
            "docker",
            "compose",
            "--profile",
            "core",
            "run",
            "--rm",
            "api",
            "python",
            "-m",
            "nexus_titan_api.seed",
        )
        run(
            "docker",
            "compose",
            "--profile",
            "core",
            "run",
            "--rm",
            "api",
            "python",
            "-m",
            "nexus_titan_api.seed",
        )
        run(sys.executable, str(ROOT / "scripts/task.py"), "smoke")
    elif args.task == "compose-check":
        run(
            "docker",
            "compose",
            "--profile",
            "core",
            "--profile",
            "distributed",
            "--profile",
            "graph",
            "--profile",
            "observe",
            "config",
            "--quiet",
        )


if __name__ == "__main__":
    main()
