"""Prepara as fotos de teste para medição.

Reduz cada imagem para no máximo 1600 px no maior lado e ~1,5 MB, limite da
Edge Function. Duplicatas (mesmo SHA-256) entram uma única vez. Saída:
scripts/label-dataset/images/.

Para testes de rajada, use --variations N para gerar cópias com pequenas
diferenças de enquadramento/qualidade e --target para outro diretório:

    python scripts/prepare-dataset-images.py --variations 3 \
      --target /tmp/burst-stress/images --manifest /tmp/burst-stress/manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

DEFAULT_SOURCE = Path(r"C:\Projetos Pessoais\Encomendaí\fotos-teste")
DEFAULT_TARGET = Path(__file__).parent / "label-dataset" / "images"


def sort_key(path: Path) -> tuple[int, str]:
    stem = path.stem
    return (int(stem), "") if stem.isdigit() else (10**9, path.name)


def variation_image(image: Image.Image, index: int) -> Image.Image:
    """Pequenas variações para simular fotos distintas na fila da rajada."""
    if index <= 0:
        return image.copy()
    width, height = image.size
    if index % 3 == 1:
        inset_x = max(1, round(width * 0.02))
        inset_y = max(1, round(height * 0.02))
        return image.crop(
            (inset_x, inset_y, width - inset_x, height - inset_y)
        )
    if index % 3 == 2:
        return ImageEnhance.Brightness(image).enhance(1.04)
    return ImageEnhance.Contrast(image).enhance(1.06)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--variations", type=int, default=1)
    parser.add_argument("--max-edge", type=int, default=1600)
    parser.add_argument("--max-bytes", type=int, default=1_500_000)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    if args.variations < 1:
        parser.error("--variations precisa ser >= 1")
    if args.max_edge < 1 or args.max_bytes < 1:
        parser.error("--max-edge e --max-bytes precisam ser > 0")

    args.target.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    manifest: list[dict[str, str | int]] = []

    for source in sorted(args.source.iterdir(), key=sort_key):
        if not source.is_file() or source.suffix.lower() not in {
            ".jpg", ".jpeg", ".png", ".webp"
        }:
            continue
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)

        with Image.open(source) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
        base.thumbnail((args.max_edge, args.max_edge), Image.Resampling.LANCZOS)

        for variation in range(args.variations):
            image = variation_image(base, variation)
            suffix = "" if variation == 0 else f"-v{variation + 1}"
            output = args.target / f"{source.stem}{suffix}.jpg"
            quality = 85
            while True:
                image.save(output, "JPEG", quality=quality, optimize=True)
                if output.stat().st_size <= args.max_bytes or quality <= 40:
                    break
                quality -= 5

            manifest.append(
                {
                    "id": f"{source.stem}{suffix}",
                    "source": source.name,
                    "variation": variation,
                    "image": str(output),
                    "width": image.width,
                    "height": image.height,
                    "bytes": output.stat().st_size,
                    "quality": quality,
                }
            )

    payload = json.dumps(manifest, ensure_ascii=False, indent=2)
    if args.manifest:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(payload + "\n", encoding="utf-8")
    if not args.quiet:
        print(payload)


if __name__ == "__main__":
    main()
