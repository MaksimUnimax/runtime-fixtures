"""Extract a bounded, provider-independent text view of a user attachment."""

import io
import json
from pathlib import PurePath
import resource
import sys
from zipfile import ZipFile


MAX_TEXT = 400_000
TEXT_SUFFIXES = {".txt", ".csv", ".tsv", ".md", ".json", ".xml", ".log", ".yaml", ".yml"}


def readable_parts(name, data):
    suffix = PurePath(name).suffix.lower()
    if suffix in {".xlsx", ".docx"}:
        with ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 2000 or sum(item.file_size for item in entries) > 32 * 1024 * 1024:
                raise ValueError("Expanded document limit")
        if suffix == ".xlsx":
            from openpyxl import load_workbook
            book = load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
            try:
                for sheet in book:
                    yield f"\nЛист {sheet.title}\n"
                    for row in sheet.iter_rows(values_only=True, max_col=min(sheet.max_column or 256, 256)):
                        yield "\t".join("" if cell is None else str(cell) for cell in row) + "\n"
                    if (sheet.max_column or 0) > 256:
                        yield "[Столбцы после 256-го пропущены]\n"
            finally:
                book.close()
        else:
            from defusedxml.ElementTree import fromstring
            with ZipFile(io.BytesIO(data)) as archive:
                tree = fromstring(archive.read("word/document.xml"))
            ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            for paragraph in tree.iter(ns + "p"):
                yield "".join(node.text or "" for node in paragraph.iter(ns + "t")) + "\n"
    elif suffix == ".pdf":
        from pypdf import PdfReader
        book = PdfReader(io.BytesIO(data))
        for number, page in enumerate(book.pages, 1):
            text = page.extract_text()
            if text.strip():
                yield f"\nСтраница {number}\n{text}"
    elif suffix in TEXT_SUFFIXES:
        if data.startswith((b"\xff\xfe", b"\xfe\xff")):
            yield data.decode("utf-16")
        elif b"\0" not in data:
            try:
                yield data.decode("utf-8-sig")
            except UnicodeDecodeError:
                yield data.decode("cp1251")
    else:
        raise NotImplementedError()


def read(name, data, start, size):
    pieces = []
    cursor = 0
    end = min(MAX_TEXT, start + size)
    for part in readable_parts(name, data):
        stop = cursor + len(part)
        if stop > start and cursor < end:
            pieces.append(part[max(0, start - cursor):end - cursor])
        cursor = stop
        if cursor > end:
            break
    if not cursor:
        return {"error": "Из файла не удалось извлечь текст. Для PDF со сканами нужен OCR."}
    result = {"name": name, "text": "".join(pieces)}
    if cursor > end:
        if end < MAX_TEXT:
            result["nextOffset"] = end
        else:
            result["truncated"] = True
    return result


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_AS, (448 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    name, offset, size = sys.argv[1:]
    try:
        result = read(name, sys.stdin.buffer.read(8 * 1024 * 1024), int(offset), int(size))
    except NotImplementedError:
        result = {"error": "Формат нельзя прочитать как текст. Поддерживаются PDF с текстом, XLSX, DOCX, CSV и текстовые файлы."}
    except Exception:
        result = {"error": "Файл повреждён, защищён паролем или превышает лимит обработки."}
    print(json.dumps(result, ensure_ascii=False))
