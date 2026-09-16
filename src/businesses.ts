/**
 * Seller registry. In the product this comes from the onboarding UI + database.
 * Each business = one proxied Service with its own routes, prices and payTo wallet.
 */
export type Param = { name: string; in: "query" | "path"; required?: boolean; description: string; example?: string };

export type TierName = "basic" | "standard" | "premium";
/** Fiverr-style packages: the same service at up to three levels of depth and price. Called at /{store}/t/{tier}{path}. */
export type Tier = { name: TierName; priceUsd: number; includes: string };

export type SellRoute = {
  tiers?: Tier[];
  method: "GET" | "POST";
  path: string; // mppx pattern, e.g. "/api/v1/lei-records/:lei"
  priceUsd: number;
  summary: string;
  params: Param[];
  sampleRequest: string; // path + query as an agent would call it
  sampleResponseNote: string;
};

export type Business = {
  id: string; // URL prefix: /{id}/...
  title: string;
  description: string;
  baseUrl: string;
  payTo?: string; // falls back to DEFAULT_PAY_TO
  licence: string;
  headers?: Record<string, string>;
  routes: SellRoute[];
  /** Served by Vendo itself (e.g. Bookkeeper, Discovery Check) instead of forwarded upstream. */
  local?: boolean;
  ownerApproved?: boolean;
  /** Website-to-Agent: sells one owner-verified web form. */
  webForm?: import("./web-agent.js").WebForm;
  /**
   * self    = the business registers the OKX AI listing with its own Agentic Wallet and receives revenue directly (default).
   * managed = Vendo registers the listing, receives revenue, and pays the business out minus a fee.
   */
  listingModel?: "self" | "managed";
  feeBps?: number;
  /**
   * The upstream endpoint answers 402 itself, on X Layer or another chain Vendo is funded for.
   * Vendo pays it out of what the buyer paid, never more, and reports the cost on the response.
   */
  upstreamX402?: boolean;
  /**
   * Required when upstreamX402 is set. Reselling someone else's paid service is only acceptable on
   * a stated basis: you own it, the owner agreed, or its licence permits resale. Vendo's rule is
   * that you list what you own or have permission to sell, so the basis is recorded and shown
   * publicly rather than left to good intentions.
   */
  upstreamPermission?: string;
  /** Encrypted upstream credentials (e.g. API key header). Never returned by the API. */
  secretHeaders?: string;
  /** paused stores are hidden from discovery and reject calls without charging */
  status?: "active" | "paused";
  listing?: { status: "not_registered" | "pending_review" | "live"; agentId?: string; listingUrl?: string; updatedAt?: string };
};

export const businesses: Business[] = [
  // --- Vendo's own paid services ---
  {
    id: "bookkeeper",
    title: "Vendo Bookkeeper",
    description: "Monthly revenue statement for any business selling through Vendo: paid calls, revenue per route and totals, as JSON or CSV.",
    baseUrl: "",
    local: true,
    ownerApproved: true,
    licence: "Vendo service.",
    routes: [{ method: "GET", path: "/statement", priceUsd: 0.02, summary: "Monthly revenue statement for a business",
      params: [{ name: "business", in: "query", required: true, description: "Business id", example: "fx" }, { name: "month", in: "query", description: "YYYY-MM", example: "2026-09" }, { name: "format", in: "query", description: "json or csv", example: "csv" }],
      sampleRequest: "/statement?business=fx&month=2026-09&format=csv", sampleResponseNote: "Statement lines and total in USDT0" }],
  },
  {
    id: "discovery",
    title: "Vendo Discovery Check",
    description: "Tests whether AI agents would pick a listing for a realistic task, scores its discoverability and returns concrete fixes.",
    baseUrl: "",
    local: true,
    ownerApproved: true,
    licence: "Vendo service.",
    routes: [{ method: "GET", path: "/check", priceUsd: 0.05, summary: "Discoverability score, agent find-test and fixes for a listing",
      params: [{ name: "business", in: "query", required: true, description: "Business id", example: "fx" }, { name: "task", in: "query", description: "Task an agent would try to do", example: "convert an invoice from EUR to SGD" }],
      sampleRequest: "/check?business=fx&task=convert%20an%20invoice%20from%20EUR%20to%20SGD", sampleResponseNote: "Score, picks out of 5 agents, issues and suggested fixes" }],
  },
  // --- Real-world finance and business data (the Vendo wedge on OKX AI) ---
  {
    id: "counterparty",
    title: "Vendo Counterparty Check",
    description: "Check a company or wallet before paying it: legal entity status from the global LEI registry, US OFAC sanctions screening, and whether the wallet is a verified business wallet. Returns pass, review or block.",
    baseUrl: "", local: true, ownerApproved: true, licence: "Vendo service using GLEIF (CC0) and US OFAC SDN public data. Risk signal, not legal advice.",
    routes: [
      { method: "GET", path: "/check", priceUsd: 0.03, summary: "Counterparty check for a company name, LEI and/or wallet",
        tiers: [
          { name: "basic", priceUsd: 0.01, includes: "Sanctions screen only" },
          { name: "standard", priceUsd: 0.03, includes: "Sanctions screen and legal entity registry check" },
          { name: "premium", priceUsd: 0.08, includes: "Registry, sanctions, verified wallet check and a signed report" },
        ],
        params: [{ name: "name", in: "query", description: "Company legal name", example: "Apple Inc." }, { name: "lei", in: "query", description: "20-character LEI", example: "HWUPKR0MPOU8FGXBT394" }, { name: "wallet", in: "query", description: "EVM wallet you are about to pay", example: "0x0000000000000000000000000000000000000001" }],
        sampleRequest: "/check?name=Apple%20Inc.&wallet=0x0000000000000000000000000000000000000001", sampleResponseNote: "JSON with verdict (pass, review, block), reasons, registry record, sanctions matches and wallet verification" },
      { method: "GET", path: "/sanctions", priceUsd: 0.01, summary: "Screen a name against the US OFAC sanctions list",
        params: [{ name: "name", in: "query", required: true, description: "Person or company name", example: "Example Trading LLC" }],
        sampleRequest: "/sanctions?name=Example%20Trading%20LLC", sampleResponseNote: "JSON with possibleMatch, top matches with similarity scores and list date" },
    ],
  },
  {
    id: "ask",
    title: "Vendo Ask",
    description: "Ask a question in plain English and get a paid answer. Vendo picks the service that can answer it, calls it, and returns the result along with which service answered and what that service costs on its own. One call instead of discovering a catalogue, learning its parameters and choosing.",
    baseUrl: "", local: true, ownerApproved: true,
    licence: "Vendo service. Routes only to services Vendo operates. Calling a service directly is cheaper when you already know which one you need.",
    routes: [{ method: "GET", path: "/q", priceUsd: 0.05, summary: "Ask a question and get a paid answer from whichever Vendo service fits",
      params: [{ name: "q", in: "query", required: true, description: "The question, in plain English", example: "is Example Trading LLC sanctioned" }],
      sampleRequest: "/q?q=is%20Example%20Trading%20LLC%20sanctioned",
      sampleResponseNote: "JSON with the answer, which service answered, that service's standalone price, and why it was chosen" }],
  },
  {
    id: "trackrecord",
    title: "Vendo ASP track record",
    description: "Delivery history for a service listed through Vendo: paid calls, success rate, uptime, repeat buyers and seller level, plus where to verify its signed delivery receipts. Built for OKX AI Evaluators settling a dispute, and for agents choosing between two providers.",
    baseUrl: "", local: true, ownerApproved: true, licence: "Vendo service. Delivery data observed by Vendo, not a guarantee of future delivery.",
    routes: [{ method: "GET", path: "/asp", priceUsd: 0.01, summary: "Delivery track record for a listed store",
      params: [{ name: "store", in: "query", required: true, description: "Store id as listed on Vendo", example: "counterparty" }],
      sampleRequest: "/asp?store=counterparty", sampleResponseNote: "JSON with paid calls, success rate, uptime over 24h and 7d, repeat buyer rate, seller level and receipt verification endpoints" }],
  },
  {
    id: "filings",
    title: "Public company filings (SEC EDGAR)",
    description: "Look up a US public company by SEC CIK: name, tickers, exchange, industry and its latest filings such as 10-K, 10-Q and 8-K. Useful for research and trading agents.",
    baseUrl: "", local: true, ownerApproved: true, licence: "SEC EDGAR public data, accessed under SEC fair access rules.",
    routes: [{ method: "GET", path: "/company", priceUsd: 0.01, summary: "Company profile and recent SEC filings",
      params: [{ name: "cik", in: "query", required: true, description: "SEC Central Index Key", example: "320193" }],
      sampleRequest: "/company?cik=320193", sampleResponseNote: "JSON with company name, tickers, exchanges, SIC industry and the 15 most recent filings" }],
  },
  {
    id: "invoice",
    title: "Stablecoin invoice calculator",
    description: "Calculate net, tax and gross amounts for an invoice and convert them to another currency at central bank reference rates, with the USDT0 amount to settle.",
    baseUrl: "", local: true, ownerApproved: true, licence: "Vendo service using Frankfurter reference rates.",
    routes: [{ method: "GET", path: "/calc", priceUsd: 0.005, summary: "Invoice tax and currency conversion",
      params: [{ name: "amount", in: "query", required: true, description: "Invoice amount", example: "1250" }, { name: "currency", in: "query", description: "Invoice currency", example: "USD" }, { name: "taxRatePct", in: "query", description: "Tax rate in percent, supplied by the caller", example: "9" }, { name: "taxInclusive", in: "query", description: "true if the amount already includes tax", example: "false" }, { name: "to", in: "query", description: "Currency to convert to", example: "SGD" }],
      sampleRequest: "/calc?amount=1250&currency=USD&taxRatePct=9&to=SGD", sampleResponseNote: "JSON with net, tax, gross, USDT0 settlement amount and converted amounts" }],
  },
  // --- Demo sellers (legal to resell) ---
  {
    id: "fx",
    title: "FX reference rates",
    description:
      "Daily currency exchange reference rates from central banks. Convert invoice amounts or check historical rates.",
    baseUrl: "https://api.frankfurter.dev",
    licence: "Frankfurter is MIT-licensed open source; check underlying provider terms. Self-host for production.",
    routes: [
      {
        method: "GET",
        path: "/v1/latest",
        priceUsd: 0.005,
        summary: "Latest reference rates for a base currency",
        params: [
          { name: "base", in: "query", description: "Base currency code", example: "EUR" },
          { name: "symbols", in: "query", description: "Comma-separated target currency codes", example: "SGD,USD" },
        ],
        sampleRequest: "/v1/latest?base=EUR&symbols=SGD,USD",
        sampleResponseNote: "JSON with base, date and rates keyed by currency code",
      },
    ],
  },
  {
    id: "company-check",
    title: "Company registry check (GLEIF)",
    description:
      "Look up legal entities in the global LEI index: legal name, status, jurisdiction, address and parent companies. Useful before paying a new supplier.",
    baseUrl: "https://api.gleif.org",
    licence: "GLEIF LEI data is published under CC0.",
    headers: { Accept: "application/vnd.api+json" },
    routes: [
      {
        method: "GET",
        path: "/api/v1/lei-records",
        priceUsd: 0.01,
        summary: "Search legal entities by name",
        params: [
          { name: "filter[entity.legalName]", in: "query", required: true, description: "Legal name to search", example: "Apple Inc." },
          { name: "page[size]", in: "query", description: "Results per page", example: "5" },
        ],
        sampleRequest: "/api/v1/lei-records?filter[entity.legalName]=Apple%20Inc.&page[size]=5",
        sampleResponseNote: "JSON:API list of LEI records with entity details",
      },
      {
        method: "GET",
        path: "/api/v1/lei-records/:lei",
        priceUsd: 0.01,
        summary: "Get one legal entity by its 20-character LEI",
        params: [{ name: "lei", in: "path", required: true, description: "Legal Entity Identifier", example: "HWUPKR0MPOU8FGXBT394" }],
        sampleRequest: "/api/v1/lei-records/HWUPKR0MPOU8FGXBT394",
        sampleResponseNote: "JSON:API record with legal name, status, jurisdiction and addresses",
      },
    ],
  },
];
