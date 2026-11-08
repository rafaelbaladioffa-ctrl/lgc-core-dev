from contextvars import ContextVar


current_audit_request = ContextVar("current_audit_request", default=None)
