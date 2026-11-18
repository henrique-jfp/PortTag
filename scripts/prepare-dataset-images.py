"""Prepara as fotos de teste para medição.

Reduz cada imagem para no máximo 1600 px no maior lado e ~1,5 MB, limite da
Edge Function. Duplicatas (mesmo SHA-256) entram uma única vez. Saída:
scripts/label-dataset/images/.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageOps

SOURCE = Path(r"C:\Projetos Pessoais\Encomendaí\fotos-teste")
TARGET = Path(__file__).parent / "label-dataset" / "images"
MAX_EDGE = 1600
MAX_BYTES = 1_500_000

TARGET.mkdir(parents=True, exist_ok=True)
seen: set[str] = set()
manifest: list[dict[str, str | int]] = []

def sort_key(path: Path) -> tuple[int, str]:
    stem = path.stem
    return (int(stem), "") if stem.isdigit() else (10**9, path.name)


for source in sorted(SOURCE.iterdir(), key=sort_key):
    if not source.is_file() or source.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
        continue
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest in seen:
        continue
    seen.add(digest)

    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)

    output = TARGET / f"{source.stem}.jpg"
    quality = 85
    while True:
        image.save(output, "JPEG", quality=quality, optimize=True)
        if output.stat().st_size <= MAX_BYTES or quality <= 40:
            break
        quality -= 5

    manifest.append(
        {
            "id": source.stem,
            "source": source.name,
            "image": f"label-dataset/images/{output.name}",
            "width": image.width,
            "height": image.height,
            "bytes": output.stat().st_size,
            "quality": quality,
        }
    )

print(json.dumps(manifest, ensure_ascii=False, indent=2))
