"""Recompute local asset budgets, checksums and mixed-license provenance after export."""
from pathlib import Path
import hashlib
import json
import shutil
import struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/models"
shutil.copyfile(ROOT / "assets/library/rocketbox/LICENSE.md", OUT / "ROCKETBOX-LICENSE.txt")
files, triangles, clips = {}, {}, {}
for name in ["batter.glb", "fielder.glb", "crowd.glb", "crowd-atlas.png", "crowd-mask.png"]:
    data = (OUT / name).read_bytes()
    files[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                   "license": ["MIT", "CC0-1.0"]}
    if name.endswith(".glb"):
        length = struct.unpack_from("<I", data, 12)[0]
        gltf = json.loads(data[20:20 + length])
        triangles[name] = sum(gltf["accessors"][p["indices"]]["count"] // 3
                              for m in gltf["meshes"] for p in m["primitives"])
        clips[name] = [a["name"] for a in gltf.get("animations", [])]
manifest = {
    "license": "Mixed MIT and CC0-1.0; see LICENSE.txt and ROCKETBOX-LICENSE.txt",
    "authoring": "Rocketbox Sports_Male_01 imported, fitted, reweighted and exported through Blender MCP. Original cricket equipment/actions retained. Crowd sprites baked in Blender.",
    "library": {"name": "Microsoft Rocketbox", "asset": "Sports_Male_01",
                "url": "https://github.com/microsoft/Microsoft-Rocketbox",
                "license": "MIT", "copyright": "Copyright (c) 2020 Microsoft"},
    "editableSource": "assets/blender/cricket-library-players.blend",
    "blenderVersion": "5.2.2 LTS", "meters": True, "bones": 19,
    "contactSeconds": 0.105, "pickupSeconds": 0.32,
    "crowd": {"count": 8640, "sectors": 12, "farTriangles": 17280,
              "nearDistanceMeters": 18, "nearInstancesMax": 480, "batchesMax": 84,
              "atlasPixels": [768, 512], "poses": ["cheering", "clapping", "seated"]},
    "files": files, "triangles": triangles, "clips": clips,
    "legacy": {"crowd-far.glb": "Preserved original CC0 asset; no longer loaded."},
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"bytes": sum(f["bytes"] for f in files.values()), "triangles": triangles}))
