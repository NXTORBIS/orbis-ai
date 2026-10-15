"""Runs FastSDCPU's own API application, bound to this computer only.

Upstream's `--api` mode hard-codes host 0.0.0.0, which would offer image generation to the whole network. This launcher
imports the same FastAPI application and serves it on 127.0.0.1. Nothing else about upstream is changed.

Usage: python serve_local.py <fastsdcpu folder> <port>
"""
import os
import sys

root = sys.argv[1]
port = int(sys.argv[2])
os.chdir(root)
sys.path.insert(0, os.path.join(root, "src"))

import uvicorn  # noqa: E402
from backend.api.web import app  # noqa: E402

uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
