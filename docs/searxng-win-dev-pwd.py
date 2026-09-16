"""
A stand-in for the Unix-only `pwd` module, so SearXNG can be run on Windows for development.

SearXNG imports `pwd` when it loads its Valkey connector, which makes it refuse to start on Windows even when Valkey
is not in use. This supplies the one call it makes. It exists only so a developer can run and test the specialized
search provider locally; production runs SearXNG on Linux, where the real module is present.

Nothing in SearXNG itself is modified: this sits on PYTHONPATH ahead of it.
"""

import os
from collections import namedtuple

struct_passwd = namedtuple('struct_passwd', 'pw_name pw_passwd pw_uid pw_gid pw_gecos pw_dir pw_shell')


def _me(uid=0):
    name = os.environ.get('USERNAME') or os.environ.get('USER') or 'orbis'
    return struct_passwd(name, 'x', uid, uid, name, os.path.expanduser('~'), '')


def getpwuid(uid):
    return _me(uid)


def getpwnam(name):
    return _me()


def getpwall():
    return [_me()]
