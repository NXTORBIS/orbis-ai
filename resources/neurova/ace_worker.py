"""NEUROVA worker for ACE-Step 1.5.

Reads one JSON request file (argv[1]), runs the documented generate_music API, and prints one JSON object per
line on stdout. Everything else goes to stderr. It never writes outside the job folder it is given.

Protocol lines: {"v":1,"job":..,"seq":n,"msg":{...}}  (see src/shared/neurova/protocol.ts)
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
    sys.path.insert(0, root)
    os.chdir(root)
    say({"type": "ready"})
    say({"type": "stage", "stage": "loading"})
    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.inference import GenerationParams, GenerationConfig, generate_music

    dit = AceStepHandler()
    status, ok = dit.initialize_service(project_root=root, config_path=REQ.get("model", "acestep-v15-turbo"), device=REQ.get("device", "auto"))
    if not ok:
        say({"type": "error", "code": "MODEL_MISSING", "message": str(status)[:400]})
        return 2
    llm = LLMHandler()
    say({"type": "stage", "stage": "generating"})
    p = REQ["params"]
    params = GenerationParams(
        task_type="text2music",
        caption=p["caption"],
        lyrics=p.get("lyrics", ""),
        instrumental=bool(p.get("instrumental", False)),
        duration=float(p.get("duration", -1)),
        bpm=p.get("bpm"),
        seed=int(p.get("seed", -1)),
        inference_steps=int(REQ.get("steps", 8)),
        thinking=False,
        shift=3.0,
    )
    c = REQ.get("config", {})
    config = GenerationConfig(batch_size=int(c.get("batch_size", 1)), use_random_seed=bool(c.get("use_random_seed", True)), seeds=c.get("seeds"), audio_format="wav")
    result = generate_music(dit, llm, params, config, save_dir=out)
    if not result.success:
        say({"type": "error", "code": "INFERENCE_FAILED", "message": str(result.error)[:400]})
        return 3
    say({"type": "stage", "stage": "decoding"})
    n = 0
    for a in result.audios:
        path = a.get("path")
        if path and os.path.isfile(path):
            say({"type": "output", "path": os.path.relpath(path, out)})
            n += 1
    if n == 0:
        say({"type": "error", "code": "OUTPUT_MISSING", "message": "The engine reported success but wrote no audio file."})
        return 4
    say({"type": "done"})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        say({"type": "error", "code": "UNKNOWN", "message": (type(e).__name__ + ": " + str(e))[:400]})
        sys.exit(1)
