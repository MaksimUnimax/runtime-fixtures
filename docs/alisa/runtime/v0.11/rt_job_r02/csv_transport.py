"""Strict, lossless CSV-to-record adapter shared by all declared CSV reads."""
import csv
import io

class CSVDecodeError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

def _reader(text, delimiter):
    return csv.reader(io.StringIO(text, newline=''), delimiter=delimiter,
                      quotechar='"', doublequote=True, skipinitialspace=False,
                      escapechar=None, strict=True)

def _header(reader):
    header = next((row for row in reader if row), None)
    if not header or any(not key.strip() for key in header) or len(set(header)) != len(header):
        raise CSVDecodeError('READ_CSV_HEADER')
    return header

def _validate(text, delimiter):
    reader = _reader(text, delimiter)
    header = _header(reader)
    for row in reader:
        if row and len(row) != len(header):
            raise CSVDecodeError('READ_CSV_SHAPE')
    return header

def decode_csv(raw, delimiter=None):
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeError:
        raise CSVDecodeError('READ_CSV_ENCODING') from None
    if not text.strip():
        raise CSVDecodeError('READ_CSV_EMPTY')
    try:
        if delimiter is not None:
            if delimiter not in (',', ';', '\t'):
                raise CSVDecodeError('READ_CSV_DIALECT')
            _validate(text, delimiter)
        else:
            valid = []
            for candidate in (',', ';', '\t'):
                try:
                    header = _validate(text, candidate)
                except (csv.Error, CSVDecodeError):
                    continue
                valid.append((candidate, header))
            multiple = [item for item in valid if len(item[1]) > 1]
            if len(multiple) == 1:
                delimiter = multiple[0][0]
            elif not multiple and len(valid) == 3 and all(item[1] == valid[0][1] for item in valid):
                delimiter = ','
            else:
                raise CSVDecodeError('READ_CSV_DIALECT')
        reader = _reader(text, delimiter)
        header = _header(reader)
        rows = []
        for row in reader:
            if not row:
                continue
            if len(row) != len(header):
                raise CSVDecodeError('READ_CSV_SHAPE')
            rows.append(dict(zip(header, row)))
        return {'rows': rows}
    except csv.Error:
        raise CSVDecodeError('READ_CSV_INVALID') from None
