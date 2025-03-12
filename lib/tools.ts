import { tool } from 'ai';
import { z } from 'zod';

/**
 * Helper function to deduplicate results by domain and URL
 */
function deduplicateByDomainAndUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    try {
      const url = new URL(item.url);
      const key = `${url.hostname}${url.pathname}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch (e) {
      // If URL parsing fails, keep the item but log the error
      console.warn(`Invalid URL: ${item.url}`);
      return true;
    }
  });
}

/**
 * Helper function to validate image URLs
 */
async function isValidImageUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const contentType = response.headers.get('content-type');
    return response.ok && contentType ? contentType.startsWith('image/') : false;
  } catch (e) {
    return false;
  }
}

/**
 * Helper function to sanitize URLs
 */
function sanitizeUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch (e) {
    return url;
  }
}

/**
 * Web scraping tool using Jina AI's Reader API
 * Scrapes a webpage and returns its content in a format optimized for LLMs
 */
export const webScrape = tool({
  description: 'Scrape a webpage and return its content in a format optimized for LLMs',
  parameters: z.object({
    url: z.string().url().describe('The URL of the webpage to scrape'),
  }),
  execute: async ({ url }: { url: string }) => {
    try {
      // Get your Jina AI API key for free: https://jina.ai/?sui=apikey
      const apiKey = process.env.JINA_API_KEY;
      if (!apiKey) {
        throw new Error('JINA_API_KEY environment variable is not set');
      }

      const response = await fetch('https://r.jina.ai/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-With-Links-Summary': 'true',
          'X-With-Images-Summary': 'true'
        },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        throw new Error(`Failed to scrape webpage: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.code !== 200) {
        throw new Error(`Failed to scrape webpage: ${data.status}`);
      }

      // Extract the content from the response
      const { title, description, content, links, images } = data.data;
      
      // Format the response
      return {
        title,
        description,
        content,
        links: links || {},
        images: images || {},
        url
      };
    } catch (error: unknown) {
      console.error('Error scraping webpage:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * Web search tool using Jina AI's Search API
 * Searches the web for information and returns results in a format optimized for LLMs
 */
export const jinaSearch = tool({
  description: 'Search the web for information using Jina AI Search API with support for multiple queries',
  parameters: z.object({
    queries: z.array(z.string()).describe('Array of search queries to look up on the web'),
    options: z.array(z.enum(['Default', 'Markdown', 'HTML', 'Text']).default('Markdown'))
      .describe('Array of format options for each query result').optional(),
    sites: z.array(z.string().optional())
      .describe('Array of domains to limit search results for each query').optional(),
    maxResults: z.array(z.number().default(5))
      .describe('Array of maximum number of results to return per query').optional(),
    withLinks: z.boolean().default(true)
      .describe('Whether to include links in the response'),
    withImages: z.boolean().default(false)
      .describe('Whether to include images in the response'),
    exclude_domains: z.array(z.string())
      .describe('A list of domains to exclude from all search results')
      .default([]),
  }),
  execute: async ({ 
    queries, 
    options = [], 
    sites = [], 
    maxResults = [], 
    withLinks, 
    withImages, 
    exclude_domains 
  }: { 
    queries: string[], 
    options?: ('Default' | 'Markdown' | 'HTML' | 'Text')[], 
    sites?: (string | undefined)[], 
    maxResults?: number[],
    withLinks: boolean,
    withImages: boolean,
    exclude_domains: string[]
  }) => {
    try {
      // Get your Jina AI API key for free: https://jina.ai/?sui=apikey
      const apiKey = process.env.JINA_API_KEY;
      if (!apiKey) {
        throw new Error('JINA_API_KEY environment variable is not set');
      }

      console.log('Queries:', queries);
      console.log('Options:', options);
      console.log('Sites:', sites);
      console.log('Max Results:', maxResults);
      console.log('Exclude Domains:', exclude_domains);

      // Execute searches in parallel
      const searchPromises = queries.map(async (query, index) => {
        try {
          const headers: Record<string, string> = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          };

          // Add optional headers
          const site = sites[index] || sites[0];
          if (site) {
            headers['X-Site'] = site;
          }
          if (withLinks) {
            headers['X-With-Links-Summary'] = 'true';
          }
          if (withImages) {
            headers['X-With-Images-Summary'] = 'true';
          }
          
          // Set the max results using X-Token-Budget header (approximate)
          const resultLimit = maxResults[index] || maxResults[0] || 5;
          // Rough estimate: 1000 tokens per result
          headers['X-Token-Budget'] = String(resultLimit * 1000);

          const response = await fetch('https://s.jina.ai/', {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
              q: query,
              options: options[index] || options[0] || 'Markdown'
            })
          });

          if (!response.ok) {
            console.warn(`Query "${query}" failed with status: ${response.status} ${response.statusText}`);
            return {
              query,
              results: [],
              images: [],
              resultCount: 0,
              imageCount: 0,
              error: `Search failed: ${response.statusText}`
            };
          }

          const data = await response.json();
          
          if (data.code !== 200) {
            console.warn(`Query "${query}" failed with code: ${data.code} ${data.status}`);
            return {
              query,
              results: [],
              images: [],
              resultCount: 0,
              imageCount: 0,
              error: `Search failed: ${data.status}`
            };
          }

          // Limit results based on maxResults parameter
          const limitedResults = data.data.slice(0, resultLimit);

          // Process and deduplicate results
          const processedResults = deduplicateByDomainAndUrl(limitedResults).map((result: any) => ({
            url: result.url,
            title: result.title,
            description: result.description || '',
            content: result.content,
            links: result.links || {},
            images: result.images || {},
          }));

          // Process images if available and requested
          let processedImages: any[] = [];
          if (withImages && data.data.some((r: any) => r.images && Object.keys(r.images).length > 0)) {
            const allImages: { url: string; description?: string }[] = [];
            
            // Collect all images from all results
            data.data.forEach((result: any) => {
              if (result.images) {
                Object.entries(result.images).forEach(([alt, url]: [string, any]) => {
                  allImages.push({ url: String(url), description: alt });
                });
              }
            });
            
            // Deduplicate and validate images
            processedImages = await Promise.all(
              deduplicateByDomainAndUrl(allImages).map(
                async ({ url, description }: { url: string; description?: string }) => {
                  const sanitizedUrl = sanitizeUrl(url);
                  const isValid = await isValidImageUrl(sanitizedUrl);
                  return isValid
                    ? {
                        url: sanitizedUrl,
                        description: description || '',
                      }
                    : null;
                }
              )
            ).then((results) =>
              results.filter(
                (image): image is { url: string; description: string } =>
                  image !== null &&
                  typeof image === 'object' &&
                  typeof image.url === 'string'
              )
            );
          }

          return {
            query,
            results: processedResults,
            images: processedImages,
            resultCount: processedResults.length,
            imageCount: processedImages.length
          };
        } catch (error: unknown) {
          console.error(`Error processing query "${query}":`, error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            query,
            results: [],
            images: [],
            resultCount: 0,
            imageCount: 0,
            error: errorMessage
          };
        }
      });

      const searchResults = await Promise.all(searchPromises);
      
      // Check if all searches failed
      const allFailed = searchResults.every(result => result.error);
      if (allFailed) {
        throw new Error("All search queries failed: " + searchResults.map(r => r.error).join(", "));
      }

      return {
        searches: searchResults,
      };
    } catch (error: unknown) {
      console.error('Error searching:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * Collection of all available tools
 */
export const tools = {
  webScrape,
  jinaSearch,
  // Add more tools here as needed
};

export default tools; 