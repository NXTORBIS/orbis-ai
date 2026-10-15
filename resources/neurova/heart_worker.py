"""NEUROVA worker for HeartMuLa (heartlib).

Reads one JSON request file (argv[1]), runs HeartMuLaGenPipeline, and prints one JSON object per line on stdout.
Everything else goes to stderr. It writes only inside the job folder it is given.
"""
import json
import os
import sys
import traceback

REQ = json.load(open(sys.argv[1], encoding="utf-8"))
JOB = REQ["job"]
_seq = 0


def say(msg):
    global _seq
    _seq += 1
    sys.stdout.write(json.dumps({"v": 1, "job": JOB, "seq": _seq, "msg": msg}) + "\n")
    sys.stdout.flush()


def main():
    root = REQ["engine_dir"]
    out = REQ["out_dir"]
    os.makedirs(out, exist_ok=True)
    sys.path.insert(0, os.path.join(root, "src"))
    say({"type": "ready"})
    say({"type": "stage", "stage": "loading"})
    import torch
    from heartlib import HeartMuLaGenPipeline

    cpu = REQ.get("device", "cpu") == "cpu"
    device = torch.device("cpu" if cpu else "cuda")
    dtype = {"mula": torch.float32 if cpu else torch.bfloat16, "codec": torch.float32}
    pipe = HeartMuLaGenPipeline.from_pretrained(
        REQ["ckpt_dir"],
        device={"mula": device, "codec": device},
        dtype=dtype,
        version="3B",
        lazy_load=False,
    )
    p = REQ["params"]
    name = "song.wav"
    say({"type": "stage", "stage": "generating"})
    with torch.no_grad():
        pipe(
            {"lyrics": p["lyrics"], "tags": p["tags"]},
            max_audio_length_ms=int(p.get("max_audio_length_ms", 30000)),
            save_path=os.path.join(out, name),
            topk=int(p.get("topk", 50)),
            temperature=float(p.get("temperature", 1.0)),
            cfg_scale=float(p.get("cfg_scale", 1.5)),
        )
    say({"type": "stage", "stage": "decoding"})
    if not os.path.isfile(os.path.join(out, name)):
        say({"type": "error", "code": "OUTPUT_INVALID", "message": "HeartMuLa finished without writing a file."})
        return
    say({"type": "output", "path": name})
    say({"type": "done"})


try:
    main()
except Exception as e:  # noqa: BLE001
    traceback.print_exc(file=sys.stderr)
    say({"type": "error", "code": "UNKNOWN", "message": (str(e) or type(e).__name__)[:400]})
    sys.exit(1)
