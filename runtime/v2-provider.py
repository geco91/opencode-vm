"""Host-side provider configuration for the isolated OpenCode 2.0.32 mode."""
import argparse
import copy
import fcntl
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid


def load(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return {}
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > 8 * 1024 * 1024:
        raise ValueError("Unsafe provider configuration file")
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or not isinstance(value.get("providers", {}), dict):
        raise ValueError("Expected a native V2 JSON configuration")
    return value


def save(path, value, backup_root):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = backup_root / ("provider-v2-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8])
    backup.mkdir(parents=True, mode=0o700)
    if path.exists():
        shutil.copyfile(path, backup / "opencode.json")
        (backup / "opencode.json").chmod(0o600)
    fd, temporary = tempfile.mkstemp(prefix=".provider-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as target:
            json.dump(value, target, ensure_ascii=False, indent=2)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def catalog(provider):
    settings = provider.get("settings", {})
    url = settings.get("baseURL", "").rstrip("/") + "/models"
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Invalid provider endpoint")
    headers = {"Accept": "application/json"}
    key = settings.get("apiKey")
    if key:
        if not isinstance(key, str) or key.startswith("{env:"):
            raise ValueError("Catalog sync requires an explicit endpoint API key")
        headers["Authorization"] = "Bearer " + key
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("Provider catalog is too large")
    entries = json.loads(raw).get("data")
    if not isinstance(entries, list) or not entries or len(entries) > 2000:
        raise ValueError("Provider returned no bounded model catalog")
    result = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"]:
            raise ValueError("Invalid provider model metadata")
        model = {"name": entry.get("name") or entry["id"]}
        context = entry.get("context_length", entry.get("max_context_length"))
        if isinstance(context, int) and not isinstance(context, bool) and context > 0:
            model["limit"] = {"context": context, "output": min(context, 8192)}
        model["capabilities"] = {"tools": True, "input": ["text"], "output": ["text"]}
        capabilities = entry.get("capabilities", [])
        modalities = entry.get("modalities", {})
        if "vision" in capabilities or "image" in modalities.get("input", []):
            model["capabilities"]["input"].append("image")
        if "reasoning" in capabilities or "thinking" in capabilities:
            model["capabilities"]["reasoning"] = {"supported": True}
        result[entry["id"]] = model
    return result


def run():
    path, backup_root, operation, *arguments = sys.argv[1:]
    path, backup_root = Path(path), Path(backup_root)
    parser = argparse.ArgumentParser(prog="opencode-vm provider custom")
    parser.add_argument("provider", nargs="?")
    parser.add_argument("--base-url")
    parser.add_argument("--api-key")
    parser.add_argument("--name")
    parser.add_argument("--model", action="append", default=[])
    parser.add_argument("--vision", action="store_true")
    parser.add_argument("--reasoning", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-new", action="store_true")
    parser.add_argument("--prompt-new", action="store_true")
    parser.add_argument("--no-context-update", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(arguments)
    if operation == "_custom_add" and sys.stdin.isatty():
        args.provider = args.provider or input("Provider ID: ").strip()
        args.base_url = args.base_url or input("Base URL: ").strip()
        args.api_key = args.api_key or getpass.getpass("API key: ")
    if operation not in ("list", "_autosync") and not re.fullmatch(r"[A-Za-z0-9._-]+", args.provider or ""):
        raise ValueError("Supply a valid provider ID")
    if args.prompt_new and not sys.stdin.isatty():
        raise ValueError("--prompt-new requires a terminal")
    if operation == "_custom_add":
        parsed = urllib.parse.urlsplit(args.base_url or "")
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or not args.api_key:
            raise ValueError("Supply --base-url and --api-key")
    # Dry-run reads do not create directories, locks, backups or config files.
    if args.dry_run or operation == "list":
        return change(path, backup_root, operation, args, load(path))
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = path.parent / ".v2-provider.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return change(path, backup_root, operation, args, load(path))


def change(path, backup_root, operation, args, config):
    original = copy.deepcopy(config)
    providers = config.setdefault("providers", {})
    if operation == "list":
        print("[provider] V2 template endpoints for new projects (credential values hidden):")
        for identifier, provider in sorted(providers.items()):
            print(f"  {identifier}: {len(provider.get('models', {}))} models; key={'yes' if provider.get('settings', {}).get('apiKey') else 'no'}")
        print(f"[provider] Config: {path}")
        return
    if operation == "_custom_add":
        models = {}
        for specification in args.model:
            parts = specification.split(":")
            if len(parts) > 4 or not parts[0]:
                raise ValueError("Expected model ID[:name[:context[:output]]]")
            parts += [""] * (4 - len(parts))
            identifier, name, context, output = parts
            model = {"name": name or identifier, "capabilities": {"tools": True, "input": ["text", "image"] if args.vision else ["text"], "output": ["text"]}}
            if context:
                if int(context) <= 0 or int(output or 8192) <= 0:
                    raise ValueError("Model limits must be positive")
                model["limit"] = {"context": int(context), "output": int(output or 8192)}
            if args.reasoning:
                model["capabilities"]["reasoning"] = {"supported": True}
                model["settings"] = {"reasoningEffort": "medium"}
            models[identifier] = model
        provider = {"name": args.name or args.provider, "package": "@ai-sdk/openai-compatible", "settings": {"baseURL": args.base_url, "apiKey": args.api_key}}
        provider["models"] = models or catalog(provider)
        for model in provider["models"].values():
            if args.vision and "image" not in model["capabilities"]["input"]:
                model["capabilities"]["input"].append("image")
            if args.reasoning:
                model["capabilities"]["reasoning"] = {"supported": True}
                model.setdefault("settings", {})["reasoningEffort"] = "medium"
        providers[args.provider] = provider
    elif operation == "_custom_rm":
        if args.provider not in providers:
            raise ValueError("Provider is not configured here")
        del providers[args.provider]
        if isinstance(config.get("model"), dict) and config["model"].get("providerID") == args.provider:
            del config["model"]
    elif operation in ("_custom_sync", "_autosync"):
        selected = [args.provider] if operation == "_custom_sync" else [identifier for identifier, value in providers.items() if urllib.parse.urlsplit(value.get("settings", {}).get("baseURL", "")).hostname in ("localhost", "127.0.0.1", "192.168.5.2", "host.lima.internal")]
        for identifier in selected:
            provider = providers.get(identifier)
            if not provider or provider.get("package") != "@ai-sdk/openai-compatible":
                raise ValueError("Expected a configured OpenAI-compatible endpoint")
            try:
                discovered = catalog(provider)
            except Exception:
                if operation == "_autosync":
                    continue
                raise
            existing = provider.setdefault("models", {})
            for model_id, metadata in discovered.items():
                if model_id not in existing:
                    if args.skip_new or (args.prompt_new and input(f"Add model {model_id}? [y/N] ").lower() != "y"):
                        continue
                    existing[model_id] = metadata
                elif not args.no_context_update and "limit" in metadata:
                    existing[model_id].setdefault("limit", {}).update({"context": metadata["limit"]["context"]})
            # Capabilities, settings, explicit disables and unadvertised models
            # remain the user's configuration, not inferred removals.
    else:
        raise ValueError("Unsupported native provider operation")
    if args.dry_run:
        print("[provider] V2 dry-run complete; no changes made.")
    elif config != original:
        save(path, config, backup_root)
        if not args.quiet and operation != "_autosync":
            print(f"[provider] Native V2 provider configuration saved: {path}")
            print("[provider] New project configs inherit this template. Configure existing projects in their native Web UI.")


if __name__ == "__main__":
    try:
        run()
    except Exception:
        # HTTP/JSON parser errors may contain response bodies or key material.
        sys.exit("[provider] Native V2 provider operation failed; configuration was retained. Check arguments, JSON format and endpoint metadata.")
