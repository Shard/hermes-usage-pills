from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"
SPEC = importlib.util.spec_from_file_location("provider_usage_status_badges_api", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class StatusBadgesApiTests(unittest.TestCase):
    def test_collect_only_fetches_connected_provider_badge_state(self) -> None:
        account = {
            "windows": [],
            "details": [],
            "meter": {"mode": "usage", "used_percent": 25, "fill_percent": 75},
        }
        with (
            patch.object(MODULE, "_connected_providers", return_value=["nous"]),
            patch.object(MODULE, "_live_account", return_value=account) as live,
            patch.object(MODULE, "_local_usage", side_effect=AssertionError("legacy local usage scan ran"), create=True),
        ):
            result = MODULE._collect()

        self.assertEqual(result["connected_providers"], ["nous"])
        self.assertEqual(result["accounts"], {"nous": account})
        self.assertNotIn("local_usage", result)
        self.assertNotIn("local_usage_note", result)
        live.assert_called_once_with("nous")


if __name__ == "__main__":
    unittest.main()
