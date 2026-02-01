# Minimal stubs for federation.v1 (regenerate with: python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. proto/federation.proto)

def _varint_encode(n):
    parts = []
    while n > 127:
        parts.append((n & 0x7F) | 0x80)
        n >>= 7
    parts.append(n)
    return bytes(parts)


def _encode_string(field_num, s):
    b = s.encode("utf-8")
    tag = (field_num << 3) | 2
    return bytes([tag]) + _varint_encode(len(b)) + b


def _parse_varint(data, pos):
    n = 0
    shift = 0
    while pos < len(data):
        b = data[pos]
        pos += 1
        n |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return n, pos
        shift += 7
    return n, pos


class HealthRequest:
    def SerializeToString(self):
        return b""


class HealthResponse:
    def __init__(self):
        self.ok = False
        self.message = ""
        self.minio_nodes = {}

    def ParseFromString(self, data):
        pos = 0
        while pos < len(data):
            if pos >= len(data):
                break
            tag = data[pos]
            pos += 1
            field_num = tag >> 3
            wire = tag & 7
            if wire == 0:  # varint
                val, pos = _parse_varint(data, pos)
                if field_num == 1:
                    self.ok = bool(val)
            elif wire == 2:  # length-delimited (string or map entry)
                length, pos = _parse_varint(data, pos)
                if pos + length > len(data):
                    break
                if field_num == 2:
                    self.message = data[pos : pos + length].decode("utf-8")
                pos += length
            else:
                break


class CheckDuplicateRequest:
    def __init__(self, sha256_hex="", bucket="", prefix=""):
        self.sha256_hex = sha256_hex
        self.bucket = bucket
        self.prefix = prefix

    def SerializeToString(self):
        parts = []
        if self.sha256_hex:
            parts.append(_encode_string(1, self.sha256_hex))
        if self.bucket:
            parts.append(_encode_string(2, self.bucket))
        if self.prefix:
            parts.append(_encode_string(3, self.prefix))
        return b"".join(parts)


class CheckDuplicateResponse:
    def __init__(self):
        self.exists = False
        self.object_key = ""

    def ParseFromString(self, data):
        pos = 0
        while pos < len(data):
            if pos >= len(data):
                break
            tag = data[pos]
            pos += 1
            field_num = tag >> 3
            wire = tag & 7
            if wire == 0:
                val, pos = _parse_varint(data, pos)
                if field_num == 1:
                    self.exists = bool(val)
            elif wire == 2:
                length, pos = _parse_varint(data, pos)
                raw = data[pos : pos + length]
                pos += length
                if field_num == 2:
                    self.object_key = raw.decode("utf-8")
            else:
                break
