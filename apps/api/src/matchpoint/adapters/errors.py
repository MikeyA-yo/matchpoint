"""Errors a connector may raise. Each maps to one HTTP status and error code in the
envelope (docs/api_design.md section 2), so a fault upstream becomes a defined error
rather than a silent wrong decision."""


class ConnectorError(Exception):
    status = 502
    code = "UPSTREAM_ERROR"

    def __init__(self, connector: str, message: str):
        super().__init__(f"{connector}: {message}")
        self.connector = connector
        self.message = message


class ConnectorUnavailable(ConnectorError):
    status = 503
    code = "UPSTREAM_UNAVAILABLE"


class ConnectorTimeout(ConnectorError):
    status = 504
    code = "UPSTREAM_TIMEOUT"


class ConnectorDataError(ConnectorError):
    """The source answered, but the payload could not be translated."""

    status = 502
    code = "UPSTREAM_BAD_DATA"


class CustomerNotFound(ConnectorError):
    status = 404
    code = "CUSTOMER_NOT_FOUND"


class DeliveryFailed(ConnectorError):
    status = 502
    code = "DELIVERY_FAILED"
