export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score: string;
  product: string;
  productId?: string;
  version: string;
  versionId?: string;
  documentType: string;
  language: string;
  date: string;
  mimeType: string;
  format: string;
  transtype: string;
  state: string;
  deliverableTitle: string;
  productPageUrl?: string;
}

export interface ProductResult {
  title: string;
  product: string;
  url: string;
  documentType: string;
}

export interface ElasticsearchResponse {
  status: string;
  data: {
    advanced: boolean;
    query: string;
    maxResults: number;
    results: SearchResult[];
    productResults: number;
    products: ProductResult[];
  };
}

export interface SemanticSearchResponse {
  status: string;
  data: {
    searchType: string;
    query: string;
    results: SearchResult[];
  };
}

export interface SearchOptions {
  language?: string;
  product?: string;
  version?: string;
  state?: string;
  maxResults?: number;
}
