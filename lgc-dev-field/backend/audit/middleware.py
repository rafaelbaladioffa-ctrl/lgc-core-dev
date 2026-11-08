from .context import current_audit_request


class AuditContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = current_audit_request.set(request)
        try:
            return self.get_response(request)
        finally:
            current_audit_request.reset(token)
