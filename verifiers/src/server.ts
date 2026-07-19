import express from "express";
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import rateLimit from "express-rate-limit";
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import type {
  HTTPAdapter,
  HTTPProcessResult,
  HTTPRequestContext,
  HTTPResponseInstructions,
  HTTPTransportContext,
  ProcessSettleResultResponse,
  RoutesConfig,
} from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { registerExactCasperScheme } from "@make-software/casper-x402/exact/server";
import { runVerifier } from "./verifier.js";
import type { VerifierConfig, VerifyQuery } from "./verifier.js";

// ---------------------------------------------------------------------------
// x402-gated verifier server.
//
// Wraps the already-tested `runVerifier` (verdict + signing) in an Express
// route that is gated by an x402 payment. The agent pays this server via
// `wrapFetchWithPayment` (see packages/adapters/casper-verifier-client.ts);
// a single paid GET returns the signed verdict (body) AND the settlement
// (PAYMENT-RESPONSE header) together.
//
// The payment gate is INJECTABLE (`opts.x402Gate`) so the handler is testable
// offline with a pass-through gate. When omitted, the real casper-x402 server
// gate is built from `opts.payment` against the hosted CSPR.cloud facilitator.
// ---------------------------------------------------------------------------

/** Payment-gate configuration for the real casper-x402 server scheme. */
export interface VerifierPaymentConfig {
  /** Hosted facilitator base URL, e.g. https://x402-facilitator.cspr.cloud. */
  facilitatorUrl: string;
  /** CSPR.cloud access token; sent as a bare `Authorization` header (NOT Bearer). */
  facilitatorToken: string;
  /** CAIP-2 network identifier, e.g. "casper:casper-test". */
  network: string;
  /** Bare 64-hex WCSPR contract package hash (no 0x prefix). */
  asset: string;
  /** Verifier's receiving account address: "00" + account-hash (66 hex). */
  payTo: string;
  /** Price in the smallest unit (motes), as an integer string. */
  priceMotes: string;
  /** WCSPR EIP-712 domain name — MUST be the token's domain ("Wrapped CSPR"). */
  tokenName: string;
  /** WCSPR EIP-712 domain version — MUST be the token's domain ("1"). */
  tokenVersion: string;
  /** Reference the observed cashflow must carry to qualify (passed to runVerifier). */
  expectedReference: string;
  /**
   * Validity window of the payment authorization, in seconds. Set explicitly on
   * the wire PaymentRequirements rather than relying on the SDK's request-time
   * default. Defaults to {@link DEFAULT_MAX_TIMEOUT_SECONDS} when omitted.
   */
  maxTimeoutSeconds?: number;
  /** Optional canonical resource URL advertised in the 402 PaymentRequired. */
  resourceUrl?: string;
}

export interface CreateVerifierAppOptions {
  verifier: VerifierConfig;
  payment: VerifierPaymentConfig;
  /**
   * Injectable payment-gate middleware. When provided it is used as-is (tests
   * pass a pass-through gate). When omitted, the real casper-x402 gate is built
   * from `payment`.
   */
  x402Gate?: RequestHandler;
  /**
   * Injectable rate-limit middleware (CWE-770 / CodeQL `js/missing-rate-limiting`).
   * When provided it is used as-is (tests pass a pass-through, or a tight limiter
   * to exercise the 429 path). When omitted, a demo-grade in-memory limiter is
   * applied (100 req / 15 min / IP). The x402 gate is the economic rate limit on
   * the PAID path; this limiter bounds the unpaid-402 flood surface. Production
   * would swap in a Redis-backed store.
   */
  rateLimiter?: RequestHandler;
}

const VERIFY_ROUTE = "/verify";

/** Default payment-authorization validity window (seconds). */
const DEFAULT_MAX_TIMEOUT_SECONDS = 300;

/**
 * Demo-grade rate limit for the /verify route: 100 requests / 15 min / IP
 * (CWE-770 / CodeQL `js/missing-rate-limiting`). The x402 payment gate is the
 * economic rate limit on the paid path; this bounds the unpaid-402 flood
 * surface. In-memory store (single-process demo); production uses Redis.
 */
const defaultVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate-limiting in the test environment so unit tests making many calls
  // to a fresh app never hit the limit unexpectedly. Tests that exercise the
  // 429 path inject an explicit tight limiter via `opts.rateLimiter`.
  skip: () => process.env.NODE_ENV === "test",
});

type PaymentVerified = Extract<HTTPProcessResult, { type: "payment-verified" }>;

/**
 * The subset of `x402HTTPResourceServer` the Express gate depends on. Extracted
 * as a seam so the deferred-settlement binding can be unit-tested offline with a
 * fake gateway; the real `x402HTTPResourceServer` satisfies it structurally.
 */
export interface X402Gateway {
  initialize(): Promise<void>;
  processHTTPRequest(context: HTTPRequestContext): Promise<HTTPProcessResult>;
  processSettlement(
    paymentPayload: PaymentVerified["paymentPayload"],
    requirements: PaymentVerified["paymentRequirements"],
    declaredExtensions?: PaymentVerified["declaredExtensions"],
    transportContext?: HTTPTransportContext,
  ): Promise<ProcessSettleResultResponse>;
}

/**
 * Build the Express app exposing `GET /verify?asset=<id>&cycle=<id>`. The route
 * is gated by the x402 payment middleware and answered by the signed-verdict
 * handler.
 */
export function createVerifierApp(opts: CreateVerifierAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  const gate = opts.x402Gate ?? buildCasperX402Gate(opts.payment, VERIFY_ROUTE);
  // Rate-limit the /verify route ahead of the x402 gate. The x402 payment is the
  // economic rate limit on the PAID path (each successful verdict costs real
  // WCSPR); this limiter bounds the unpaid-402 flood surface (CWE-770). Demo-grade
  // in-memory store; production swaps in a Redis-backed limiter.
  const limiter = opts.rateLimiter ?? defaultVerifyRateLimiter;
  app.get(VERIFY_ROUTE, limiter, gate, makeVerifyHandler(opts));

  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
      // Last-resort handler: log the actionable detail server-side, return a
      // non-leaky error to the caller. Never swallow silently.
      console.error("[verifier] error while serving GET /verify:", err);
      if (res.headersSent) return;
      res.status(500).json({ error: "verifier failed to process the request" });
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Verdict handler (runs only after the gate admits the request)
// ---------------------------------------------------------------------------

function makeVerifyHandler(opts: CreateVerifierAppOptions): RequestHandler {
  return (req, res, next) => {
    handleVerify(opts, req, res).catch(next);
  };
}

async function handleVerify(
  opts: CreateVerifierAppOptions,
  req: Request,
  res: Response,
): Promise<void> {
  const assetId = readRequiredParam(req, "asset");
  if (assetId === null) {
    res
      .status(400)
      .json({ error: "missing or blank required query parameter: asset" });
    return;
  }

  const cycleId = readRequiredParam(req, "cycle");
  if (cycleId === null) {
    res
      .status(400)
      .json({ error: "missing or blank required query parameter: cycle" });
    return;
  }

  const query: VerifyQuery = {
    assetId,
    cycleId,
    expectedAmount: opts.payment.priceMotes,
    expectedReference: opts.payment.expectedReference,
  };

  const signed = await runVerifier(opts.verifier, query);
  res.status(200).json(signed);
}

/** Returns a trimmed, non-empty single string query param, or null otherwise. */
function readRequiredParam(req: Request, name: string): string | null {
  const raw = req.query[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Real casper-x402 gate
//
// @x402/core's resource server is framework-agnostic: it exposes
// `processHTTPRequest` (verify) and `processSettlement` (settle), not an Express
// middleware. This function provides the Express binding: an HTTPAdapter over
// the request, plus deferred settlement so the PAYMENT-RESPONSE header lands on
// the response before the verdict body is flushed.
//
// The facilitator network call (`initialize()` -> GET /supported) is lazy and
// runs on the first request. The unpaid->402 and paid->200 paths therefore
// require the live facilitator and are verified live by the controller; they are
// not exercised by the offline unit tests.
// ---------------------------------------------------------------------------

function buildCasperX402Gate(
  payment: VerifierPaymentConfig,
  routePath: string,
): RequestHandler {
  const facilitator = new HTTPFacilitatorClient({
    url: payment.facilitatorUrl,
    // CSPR.cloud authenticates with a bare token in the Authorization header
    // (NOT `Bearer <token>`). The same value gates verify/settle/supported.
    createAuthHeaders: async () => {
      const headers = { Authorization: payment.facilitatorToken };
      return {
        verify: { ...headers },
        settle: { ...headers },
        supported: { ...headers },
      };
    },
  });

  const resourceServer = new x402ResourceServer(facilitator);
  registerExactCasperScheme(resourceServer);

  const routes: RoutesConfig = {
    [`GET ${routePath}`]: {
      accepts: {
        scheme: "exact",
        network: payment.network as Network,
        payTo: payment.payTo,
        // AssetAmount price carries BOTH the WCSPR asset and the exact motes.
        price: { asset: payment.asset, amount: payment.priceMotes },
        // Set explicitly so the validity window is part of the wire
        // requirements rather than an SDK default applied at request time.
        maxTimeoutSeconds: payment.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS,
        // MUST equal the WCSPR EIP-712 domain or settlement fails
        // `invalid_signature`; merged into the wire PaymentRequirements.extra.
        extra: { name: payment.tokenName, version: payment.tokenVersion },
      },
      ...(payment.resourceUrl !== undefined
        ? { resource: payment.resourceUrl }
        : {}),
    },
  };

  const httpServer = new x402HTTPResourceServer(resourceServer, routes);
  return buildX402GateMiddleware(httpServer);
}

/**
 * Wrap an {@link X402Gateway} as an Express middleware: lazily initialize it on
 * the first request (the facilitator `GET /supported` call), then run the
 * verify -> handler -> settle binding. Exposed so the binding can be exercised
 * offline with a fake gateway.
 */
export function buildX402GateMiddleware(gateway: X402Gateway): RequestHandler {
  let initPromise: Promise<void> | null = null;
  const ensureInitialized = (): Promise<void> => {
    if (initPromise === null) {
      initPromise = gateway.initialize().catch((err: unknown) => {
        initPromise = null; // let a later request retry initialization
        throw err;
      });
    }
    return initPromise;
  };

  return (req, res, next) => {
    runCasperX402Gate(gateway, ensureInitialized, req, res, next).catch(next);
  };
}

async function runCasperX402Gate(
  gateway: X402Gateway,
  ensureInitialized: () => Promise<void>,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await ensureInitialized();

  const adapter = new ExpressHTTPAdapter(req);
  const context: HTTPRequestContext = {
    adapter,
    path: req.path,
    method: req.method,
  };

  const result = await gateway.processHTTPRequest(context);

  switch (result.type) {
    case "no-payment-required":
      next();
      return;
    case "payment-error":
      writeInstructions(res, result.response);
      return;
    case "payment-verified":
      // Payment verified; settle only after the handler succeeds.
      installSettlementInterceptor(gateway, context, result, res, next);
      next();
      return;
    default: {
      // Exhaustiveness guard: a new HTTPProcessResult variant must be handled
      // explicitly rather than silently leaving the request hanging.
      const exhaustive: never = result;
      throw new Error(
        `unhandled x402 process result: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/**
 * Defer settlement until the handler writes its response. We patch `res.json`
 * ONLY — the verdict handler always responds via `res.json`, and that is the
 * single sink we intercept; a handler that wrote via `res.send`/`res.end`
 * instead would bypass settlement (it would never run). On a successful (2xx)
 * verdict the payment is settled and the PAYMENT-RESPONSE header is attached
 * BEFORE the body is flushed. A non-2xx response (e.g. a 400 validation error)
 * is flushed without settling — the agent is never charged for a request we
 * refused.
 */
function installSettlementInterceptor(
  gateway: X402Gateway,
  context: HTTPRequestContext,
  verified: PaymentVerified,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res) as (body?: unknown) => Response;

  res.json = function patchedJson(body?: unknown): Response {
    // Restore immediately so settlement (and any failure response) runs once.
    res.json = originalJson as typeof res.json;

    if (res.statusCode >= 400) {
      return originalJson(body);
    }

    void settleThenFlush(gateway, context, verified, res, originalJson, body, next);
    return res;
  } as typeof res.json;
}

async function settleThenFlush(
  gateway: X402Gateway,
  context: HTTPRequestContext,
  verified: PaymentVerified,
  res: Response,
  originalJson: (body?: unknown) => Response,
  body: unknown,
  next: NextFunction,
): Promise<void> {
  try {
    const settlement = await gateway.processSettlement(
      verified.paymentPayload,
      verified.paymentRequirements,
      verified.declaredExtensions,
      { request: context },
    );

    if (!settlement.success) {
      // Settlement failed after a valid verdict: discard the body and return
      // the SDK's settlement-failure response (402 + PAYMENT-RESPONSE).
      writeInstructions(res, settlement.response);
      return;
    }

    for (const [name, value] of Object.entries(settlement.headers)) {
      res.setHeader(name, value);
    }
    originalJson(body);
  } catch (err) {
    next(err);
  }
}

/** Write framework-agnostic HTTPResponseInstructions to an Express response. */
function writeInstructions(res: Response, instr: HTTPResponseInstructions): void {
  res.status(instr.status);
  for (const [name, value] of Object.entries(instr.headers)) {
    res.setHeader(name, value);
  }
  if (instr.isHtml) {
    res.send(typeof instr.body === "string" ? instr.body : "");
  } else {
    res.json(instr.body ?? {});
  }
}

/** Express-backed implementation of the framework-agnostic x402 HTTPAdapter. */
class ExpressHTTPAdapter implements HTTPAdapter {
  constructor(private readonly req: Request) {}

  getHeader(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  getMethod(): string {
    return this.req.method;
  }

  getPath(): string {
    return this.req.path;
  }

  getUrl(): string {
    const host = this.req.get("host") ?? "localhost";
    return `${this.req.protocol}://${host}${this.req.originalUrl}`;
  }

  getAcceptHeader(): string {
    return this.req.get("accept") ?? "";
  }

  getUserAgent(): string {
    return this.req.get("user-agent") ?? "";
  }
}
