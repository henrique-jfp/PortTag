"""Converte a planilha de correção manual (xlsx) no TSV do gabarito.

A planilha é a fonte revisada por humano: cada linha de dados corresponde, em
ordem, à foto `1.jpg`, `2.jpg`, ... de `scripts/label-dataset/images`. A coluna
`id` serve só de conferência; se ela divergir da posição, o script avisa.

Convenções do TSV gerado:
  - célula vazia            -> campo não medido (null);
  - `#vazio`                -> string vazia confirmada (o dado não existe);
  - "ilegível" na planilha  -> célula vazia (não há como medir);
  - número do Excel         -> inteiro sem notação científica (CEP, unidade...).

Depois da primeira importação o TSV passa a ser a fonte autoritativa: as
correções humanas (inclusive as validadas por OCR) são feitas nele. Rodar este
script de novo sobrescreveria essas correções, então ele exige `--force`.

Uso: python scripts/import-gabarito-xlsx.py [--force] [arquivo.xlsx]
"""

from __future__ import annotations

import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = ROOT / "scripts" / "label-reports" / "correcao-manual.xlsx"
OUTPUT_TSV = ROOT / "scripts" / "label-reports" / "gabarito-revisado.tsv"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
COLUMNS = [
    "id",
    "tracking_code",
    "carrier",
    "destination_cep",
    "recipient_name",
    "unit_number",
    "block_name",
    "destination_street",
    "destination_number",
]
EXTRA_COLUMNS = ["address_status", "notes"]

# Transportadoras fora do enum do app: a leitura correta é "sem transportadora
# identificável", então o gabarito não pode exigir o nome comercial.
OUT_OF_ENUM_CARRIERS = {"petz"}

# Foto 16 já tinha `address_status` conferido contra o endereço de referência
# do dataset (Rua Ferreira Viana, 45 / 22210-040). As demais não têm endereço
# de condomínio associado, então o status não é medido.
ADDRESS_STATUS = {"16": "verified"}

ROW_NOTES = {
    "11": "Mesma etiqueta da foto 16 (Katia Argollo).",
    "16": "Mesma etiqueta da foto 11.",
    "17": "Mesma etiqueta da foto 1 (fotos diferentes do mesmo pacote).",
}

ILLEGIBLE = {"ilegivel", "ilegiveis", "nao legivel", "nao legiveis", "?"}


def column_letter(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def read_rows(path: Path) -> list[dict[str, str]]:
    """Lê a primeira aba sem depender de openpyxl/pandas."""
    with zipfile.ZipFile(path) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall(f"{NS}si"):
                shared.append(
                    "".join(node.text or "" for node in item.iter(f"{NS}t"))
                )
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    rows: list[dict[str, str]] = []
    for row in sheet.findall(f".//{NS}sheetData/{NS}row"):
        values: dict[str, str] = {}
        for cell in row.findall(f"{NS}c"):
            match = re.match(r"[A-Z]+", cell.get("r") or "")
            if not match:
                continue
            kind = cell.get("t")
            value_node = cell.find(f"{NS}v")
            if kind == "inlineStr":
                text = "".join(
                    node.text or "" for node in cell.iter(f"{NS}t")
                )
            elif value_node is None:
                text = ""
            elif kind == "s":
                text = shared[int(value_node.text)]
            else:
                text = value_node.text or ""
            values[match.group(0)] = text
        rows.append((int(row.get("r") or 0), values))
    rows.sort(key=lambda item: item[0])
    return [values for _, values in rows]


def fold(text: str) -> str:
    return (
        "".join(
            character
            for character in unicodedata.normalize("NFKD", text)
            if not unicodedata.combining(character)
        )
        .strip()
        .lower()
    )


def number_text(text: str) -> str:
    """Devolve inteiros do Excel sem notação científica nem `.0`."""
    candidate = text.strip()
    if not re.fullmatch(r"-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?", candidate):
        return candidate
    value = float(candidate.replace(",", "."))
    if abs(value - round(value)) < 1e-9 and abs(value) < 1e15:
        return str(int(round(value)))
    return candidate


def cell_value(raw: str) -> str:
    return number_text(raw)


def main() -> int:
    arguments = [argument for argument in sys.argv[1:] if not argument.startswith("--")]
    force = "--force" in sys.argv
    xlsx_path = Path(arguments[0]) if arguments else DEFAULT_XLSX
    if not xlsx_path.exists():
        print(f"Planilha não encontrada: {xlsx_path}", file=sys.stderr)
        return 1
    if OUTPUT_TSV.exists() and not force:
        print(
            f"{OUTPUT_TSV} já existe e é a fonte autoritativa do gabarito.\n"
            "Corrija o TSV diretamente; use --force só para regerar a partir da "
            "planilha (isso descarta as correções feitas no TSV).",
            file=sys.stderr,
        )
        return 1

    rows = read_rows(xlsx_path)
    if not rows:
        print("Planilha vazia.", file=sys.stderr)
        return 1

    header = [fold(rows[0].get(column_letter(index), "")) for index in range(len(COLUMNS))]
    if header[: len(COLUMNS)] != COLUMNS:
        print(
            "Cabeçalho inesperado: "
            + ", ".join(rows[0].get(column_letter(i), "") for i in range(len(COLUMNS))),
            file=sys.stderr,
        )
        return 1

    records = rows[1:]
    warnings: list[str] = []
    output_rows: list[list[str]] = []

    for position, values in enumerate(records, start=1):
        sample_id = str(position)
        raw = {
            name: cell_value(values.get(column_letter(index), ""))
            for index, name in enumerate(COLUMNS)
        }
        notes: list[str] = []

        if raw["id"].strip() and number_text(raw["id"]) != sample_id:
            warnings.append(
                f"linha da foto {sample_id}: coluna id diz {raw['id']} (mapeamento é por posição)"
            )

        record: dict[str, str] = {}
        illegible_fields: list[str] = []
        for name in COLUMNS[1:]:
            value = raw[name].strip()
            if fold(value) in ILLEGIBLE:
                illegible_fields.append(name)
                record[name] = ""
                continue
            record[name] = value

        if illegible_fields:
            notes.append("ilegível: " + ", ".join(illegible_fields))

        if fold(record["carrier"]) in OUT_OF_ENUM_CARRIERS:
            delivery_code = record["tracking_code"]
            notes.append(
                "Petz fora do enum: código de entrega "
                f"{delivery_code or 'não lido'}, sem rastreio."
            )
            record["carrier"] = "#vazio"
            record["tracking_code"] = "#vazio"

        for field, value in record.items():
            if value == "#vazio":
                continue
            if not value:
                continue
            if field in {"unit_number", "block_name"} and re.search(
                r"[a-z]", fold(value)
            ) and not re.fullmatch(r"[a-z]?\d+[a-z]?", fold(value)):
                notes.append(f"conferir {field}: {value!r}")

        if sample_id in ROW_NOTES:
            notes.append(ROW_NOTES[sample_id])

        output_rows.append(
            [
                sample_id,
                *[record[name] for name in COLUMNS[1:]],
                ADDRESS_STATUS.get(sample_id, ""),
                " ".join(notes),
            ]
        )

    header_out = ["id", *COLUMNS[1:], *EXTRA_COLUMNS]
    OUTPUT_TSV.write_text(
        "\n".join(["\t".join(header_out), *("\t".join(row) for row in output_rows)])
        + "\n",
        encoding="utf-8",
    )

    print(f"Fotos: {len(output_rows)} -> {OUTPUT_TSV}")
    measured = {
        name: sum(
            1
            for row in output_rows
            if row[header_out.index(name)].strip() not in {"", "#vazio"}
        )
        for name in header_out
        if name not in {"id", "notes"}
    }
    print("Campos com gabarito medível:")
    for name, total in measured.items():
        print(f"  {name:<22} {total}/{len(output_rows)}")
    for warning in warnings:
        print(f"AVISO: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
