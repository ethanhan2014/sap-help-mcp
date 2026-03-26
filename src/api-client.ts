import axios, { AxiosInstance } from "axios";
import type {
  ElasticsearchResponse,
  SemanticSearchResponse,
  SearchOptions,
  SearchResult,
  ProductResult,
} from "./types.js";

const DEFAULT_MAX_RESULTS = 20;

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
    const fullUrl = url.startsWith("http") ? url : `https://help.sap.com${url}`;

    const response = await this.http.get<string>(fullUrl, {
      headers: { accept: "text/html" },
      responseType: "text",
    });

    return this.cleanHtml(response.data);
  }

  private cleanHtml(html: string): string {
    let content = html;

    // Try to extract main content area
    const mainStart = content.indexOf('<main');
    const mainEnd = content.indexOf('</main>');
    if (mainStart !== -1 && mainEnd !== -1) {
      content = content.substring(mainStart, mainEnd + 7);
    }

    // Remove script and style tags
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

    return content;
  }
}
