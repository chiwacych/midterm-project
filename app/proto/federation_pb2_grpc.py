# Minimal gRPC stub for FederationService (regenerate with grpc_tools.protoc)

from . import federation_pb2 as fp


def _deserialize_health(b):
    r = fp.HealthResponse()
    r.ParseFromString(b)
    return r


def _deserialize_check_duplicate(b):
    r = fp.CheckDuplicateResponse()
    r.ParseFromString(b)
    return r


class FederationServiceStub:
    def __init__(self, channel):
        self._channel = channel
        self._Health = channel.unary_unary(
            "/federation.v1.FederationService/Health",
            request_serializer=lambda r: r.SerializeToString(),
            response_deserializer=_deserialize_health,
        )
        self._CheckDuplicate = channel.unary_unary(
            "/federation.v1.FederationService/CheckDuplicate",
            request_serializer=lambda r: r.SerializeToString(),
            response_deserializer=_deserialize_check_duplicate,
        )

    def Health(self, request, timeout=None, metadata=None):
        return self._Health(request, timeout=timeout, metadata=metadata)

    def CheckDuplicate(self, request, timeout=None, metadata=None):
        return self._CheckDuplicate(request, timeout=timeout, metadata=metadata)
