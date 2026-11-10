# Anatomy Mirror assets

`public/anatomy/head.{bin,json}` and `hand.{bin,json}` are built offline by these scripts from
**BodyParts3D** (© The Database Center for Life Science, licensed CC BY-SA 2.1 JP,
https://lifesciencedb.jp/bp3d/). The meshes are simplified and re-fitted, and they stay under
CC BY-SA 2.1 JP (see `public/anatomy/LICENSE.txt`). The app code that renders them is Roamly's own.

## Rebuild
Needs Python 3 with `numpy`, `trimesh` and `fast-simplification`.

```bash
mkdir -p work && cd work
# BodyParts3D STLs (a mirror of release 3.0); only assets/BodyParts3D_data is needed
git clone --depth 1 --filter=blob:none --sparse https://github.com/Kevin-Mattheus-Moerman/BodyParts3D repo
(cd repo && git sparse-checkout set assets/BodyParts3D_data)
# MediaPipe's canonical face (the space the face tracker reports poses in)
curl -LO https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj
mkdir -p out
python3 ../align.py        # similarity fit: BodyParts3D head → canonical face (writes align.json)
python3 ../build.py        # skull, jaw, eyes, brain, facial muscles → out/head.{bin,json}
python3 ../build_hand.py   # right-hand bones, per finger segment → out/hand.{bin,json}
cp out/* ../../../public/anatomy/
```

## Format
Each `.bin` is, per part, Uint16 positions quantized to the part's bounding box (`min`/`max` in
the `.json`) followed by Uint16 triangle indices; `vOffset`/`iOffset` are byte offsets.
Head parts are in MediaPipe canonical-face centimetres. Hand parts are normalized: `palm`
to palm width/length between landmarks 0, 5, 9 and 17, and each `segment` to the bone between
its two landmarks, so the runtime can stretch them onto any tracked hand.
