"""Monta uma folha de contato das fotos do dataset para revisão do gabarito."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

IMAGES = Path(__file__).parent / "label-dataset" / "images"
OUTPUT = Path(__file__).parent / "label-reports" / "contact-sheet.jpg"
COLUMNS = 4
CELL = (420, 340)
THUMB = (400, 300)

def sort_key(path: Path) -> tuple[int, str]:
    stem = path.stem
    return (int(stem), "") if stem.isdigit() else (10**9, path.name)


files = sorted(
    (
        path
        for path in IMAGES.iterdir()
        if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    ),
    key=sort_key,
)
rows = (len(files) + COLUMNS - 1) // COLUMNS
sheet = Image.new("RGB", (COLUMNS * CELL[0], rows * CELL[1]), "white")
draw = ImageDraw.Draw(sheet)

for index, path in enumerate(files):
    with Image.open(path) as opened:
        thumb = ImageOps.contain(ImageOps.exif_transpose(opened), THUMB)
    x = (index % COLUMNS) * CELL[0] + 10
    y = (index // COLUMNS) * CELL[1] + 10
    sheet.paste(thumb, (x, y + 28))
    draw.text((x, y + 8), path.stem, fill="black")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
sheet.save(OUTPUT, "JPEG", quality=80)
print(OUTPUT)
