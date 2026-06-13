from __future__ import annotations

import argparse
import json

from backend.app.store import DemoStore


def seed_open_data() -> None:
    store = DemoStore()
    payload = {
        "datasets": len(store.datasets),
        "layers": len(store.layers),
        "objects": len(store.objects),
        "scenarios": len(store.scenarios),
        "queue_1_file_sources": 12,
        "queue_2_api_connectors": 2,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["seed-open-data"])
    args = parser.parse_args()
    if args.command == "seed-open-data":
        seed_open_data()


if __name__ == "__main__":
    main()
