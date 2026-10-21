export class ApiError extends Error {
  status: number;
  code: string;
  traceId?: string;
  // Set by the client: the request that failed ("POST /sim/activity") and who answered it
  endpoint?: string;
  servedBy?: "live" | "mock";

  constructor(status: number, code: string, message: string, traceId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.traceId = traceId;
  }
}
