import axios, { AxiosInstance } from "axios";
import type {
  ElasticsearchResponse,
  SemanticSearchResponse,
  DeliverableMetadataResponse,
  PageContentResponse,
  SearchOptions,
  SearchResult,
  ProductResult,
} from "./types.js";

const DEFAULT_MAX_RESULTS = 20;

interface ParsedHelpUrl {
  productUrl: string;
  deliverableLoio: string;
  topicLoio: string;
  version: string;
  state: string;
}

export class SapHelpClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: "https://help.sap.com",
      timeout: 15000,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const params: Record<string, string | number> = {
      q: query,
      area: "content",
      language: options.language || "en-US",
      state: options.state || "PRODUCTION",
      transtype: "standard,html,pdf,others",
      to: options.maxResults || DEFAULT_MAX_RESULTS,
      advancedSearch: 0,
      excludeNotSearchable: 1,
    };

    if (options.product) params.product = options.product;
    if (options.version) params.version = options.version;

    const response = await this.http.get<ElasticsearchResponse>(
      "/http.svc/elasticsearch",
      { params },
    );

    return response.data.data.results;
  }

  async semanticSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      searchType: "SEMANTIC",
      to: options.maxResults || DEFAULT_MAX_RESULTS,
      keywordHighlight: true,
      semanticHighlight: true,
      transTypes: ["standard", "html", "pdf", "others"],
      states: [options.state || "PRODUCTION"],
    };

    if (options.product) {
      body.products = [options.product];
    }
    if (options.version) {
      body.version = options.version;
    }
    if (options.language && options.language !== "en-US") {
      body.mtLanguage = options.language;
    }

    const response = await this.http.post<SemanticSearchResponse>(
      "/http.svc/semanticsearch",
      body,
    );

    return response.data.data.results;
  }

  async listProducts(): Promise<ProductResult[]> {
    const params = {
      area: "browser",
      state: "DRAFT,TEST,PRODUCTION",
      q: "",
      transtype: "standard,html,pdf,others",
    };

    const response = await this.http.get<ElasticsearchResponse>(
      "/http.svc/elasticsearch",
      { params },
    );

    return response.data.data.products;
  }

  async fetchPage(url: string): Promise<string> {
    const parsed = this.parseHelpUrl(url);
    if (!parsed) {
      throw new Error(`Cannot parse SAP Help URL: ${url}`);
    }

    const metadata = await this.getDeliverableMetadata(parsed);
    const deliverableId = metadata.data.deliverable.id;
    const buildNo = metadata.data.deliverable.build ?? metadata.data.deliverable.buildNo;
    const filePath = metadata.data.filePath || `${parsed.topicLoio}.html`;

    const content = await this.getPageContent(deliverableId, filePath, buildNo);
    const title = content.data.currentPage.t;
    const bodyHtml = content.data.body;

    return this.htmlToText(title, bodyHtml);
  }

  private parseHelpUrl(url: string): ParsedHelpUrl | null {
    const fullUrl = url.startsWith("http") ? url : `https://help.sap.com${url}`;
    let parsed: URL;
    try {
      parsed = new URL(fullUrl);
    } catch {
      return null;
    }

    // URL pattern: /docs/{productUrl}/{deliverableLoio}/{topicLoio}.html
    const pathParts = parsed.pathname.replace(/^\/docs\//, "").split("/").filter(Boolean);
    if (pathParts.length < 2) return null;

    const productUrl = pathParts[0];
    const deliverableLoio = pathParts[1];
    const topicLoio = pathParts[2]?.replace(/\.html$/, "") || "";
    const version = parsed.searchParams.get("version") || "LATEST";
    const state = parsed.searchParams.get("state") || "PRODUCTION";

    return { productUrl, deliverableLoio, topicLoio, version, state };
  }

  private async getDeliverableMetadata(parsed: ParsedHelpUrl): Promise<DeliverableMetadataResponse> {
    const params: Record<string, string | number> = {
      product_url: parsed.productUrl,
      deliverable_url: parsed.deliverableLoio,
      version: parsed.version,
      state: parsed.state,
      deliverableInfo: 1,
      toc: 0,
      loadlandingpageontopicnotfound: 1,
    };
    if (parsed.topicLoio) {
      params.topic_url = `${parsed.topicLoio}.html`;
    }

    const response = await this.http.get<DeliverableMetadataResponse>(
      "/http.svc/deliverableMetadata",
      { params },
    );
    return response.data;
  }

  private async getPageContent(
    deliverableId: number,
    filePath: string,
    buildNo?: number,
  ): Promise<PageContentResponse> {
    const params: Record<string, string | number> = {
      deliverable_id: deliverableId,
      file_path: filePath,
      deliverableInfo: 0,
      loadlandingpageontopicnotfound: 1,
    };
    if (buildNo) params.buildNo = buildNo;

    const response = await this.http.get<PageContentResponse>(
      "/http.svc/pagecontent",
      { params },
    );
    return response.data;
  }

  private htmlToText(title: string, html: string): string {
    let content = html;

    // Remove script, style, noscript tags
    content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
    content = content.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");

    // Convert structural HTML to newlines
    content = content.replace(/<br\s*\/?>/gi, "\n");
    content = content.replace(/<\/?(div|p|h[1-6]|li|ul|ol|table|tr|td|th|section|article|header|footer|nav|aside)[^>]*>/gi, "\n");

    // Strip remaining tags
    content = content.replace(/<[^>]+>/g, "");

    // Decode HTML entities
    content = content
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#\d+;/g, "");

    // Clean whitespace
    content = content.replace(/[ \t]+/g, " ");
    content = content.replace(/\n\s*\n/g, "\n\n");
    content = content.trim();

    return `# ${title}\n\n${content}`;
  }
}
