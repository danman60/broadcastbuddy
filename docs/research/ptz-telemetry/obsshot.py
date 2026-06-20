#!/usr/bin/env python3
"""OBS WS v5 read-only client: list inputs / grab source screenshot.
Read-only — NEVER stops stream/record. Connects via SSH tunnel localhost:4455."""
import sys, json, base64, hashlib, time
import websocket  # websocket-client

HOST = "ws://127.0.0.1:4455"
PW = "123456"

def auth_str(pw, salt, challenge):
    s1 = base64.b64encode(hashlib.sha256((pw + salt).encode()).digest()).decode()
    return base64.b64encode(hashlib.sha256((s1 + challenge).encode()).digest()).decode()

def connect():
    ws = websocket.create_connection(HOST, timeout=10)
    hello = json.loads(ws.recv())
    d = hello["d"]
    ident = {"op": 1, "d": {"rpcVersion": 1}}
    if "authentication" in d:
        a = d["authentication"]
        ident["d"]["authentication"] = auth_str(PW, a["salt"], a["challenge"])
    ws.send(json.dumps(ident))
    json.loads(ws.recv())  # Identified
    return ws

def req(ws, rtype, data=None, rid="r1"):
    ws.send(json.dumps({"op": 6, "d": {"requestType": rtype, "requestId": rid,
                                       "requestData": data or {}}}))
    while True:
        m = json.loads(ws.recv())
        if m["op"] == 7 and m["d"]["requestId"] == rid:
            return m["d"]

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "inputs"
    ws = connect()
    if cmd == "inputs":
        r = req(ws, "GetInputList")
        for i in r["responseData"]["inputs"]:
            print(i["inputName"], "|", i["inputKind"])
        sc = req(ws, "GetSceneList")
        print("CURRENT SCENE:", sc["responseData"].get("currentProgramSceneName"))
    elif cmd == "shot":
        src = sys.argv[2]
        out = sys.argv[3] if len(sys.argv) > 3 else "/tmp/obsshot.jpg"
        w = int(sys.argv[4]) if len(sys.argv) > 4 else 960
        r = req(ws, "GetSourceScreenshot", {"sourceName": src, "imageFormat": "jpg",
                                            "imageWidth": w})
        if not r["requestStatus"]["result"]:
            print("ERR:", r["requestStatus"]); sys.exit(1)
        data = r["responseData"]["imageData"].split(",", 1)[1]
        open(out, "wb").write(base64.b64decode(data))
        print("wrote", out)
    ws.close()

main()
