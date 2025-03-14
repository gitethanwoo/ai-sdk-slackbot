import { tool } from 'ai';
import { z } from 'zod';
import { generateText, generateObject } from 'ai';
import { perplexity } from '@ai-sdk/perplexity';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';

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
 * Web scraping tool using Jina AI's Reader API
 * Scrapes a webpage and returns its content in a format optimized for LLMs
 */
export const webScrape = tool({
  description: 'Scrape a webpage and return its content in a format optimized for LLMs',
  parameters: z.object({
    url: z.string().describe('The URL of the webpage to scrape (must be a valid HTTP/HTTPS URL)'),
  }),
  execute: async ({ url }: { url: string }, options?: { updateStatus?: (status: string) => void }) => {
    try {
      const updateStatus = options?.updateStatus;
      
      // Get your Jina AI API key for free: https://jina.ai/?sui=apikey
      const apiKey = process.env.JINA_API_KEY;
      if (!apiKey) {
        throw new Error('JINA_API_KEY environment variable is not set');
      }

      if (updateStatus) {
        updateStatus("is fetching webpage content...");
        console.log("Status updated to 'is fetching webpage content...'");
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

      if (updateStatus) {
        updateStatus("is processing webpage data...");
        console.log("Status updated to 'is processing webpage data...'");
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
  description: 'Search the web for information by generating multiple related queries from your question',
  parameters: z.object({
    query: z.string().describe('The search query or question to research'),
  }),
  execute: async ({ query }: { query: string }, options?: { updateStatus?: (status: string) => void }) => {
    try {
      const updateStatus = options?.updateStatus;
      console.log('Original query:', query);
      
      // Check if JINA_API_KEY is set
      const apiKey = process.env.JINA_API_KEY;
      if (!apiKey) {
        throw new Error('JINA_API_KEY environment variable is not set');
      }

      // Step 1: Generate 5 related search queries using OpenAI's o3-mini
      if (updateStatus) {
        updateStatus("is generating search queries...");
        console.log("Status updated to 'is generating search queries...'");
      }
      
      console.log('Generating related search queries...');
      
      // Get current date and time for context
      const currentDate = new Date().toISOString().split('T')[0];
      const currentTime = new Date().toTimeString().split(' ')[0];
      console.log(`Current date: ${currentDate}, time: ${currentTime}`);
      
      // Define the schema for our query generation
      const querySchema = z.object({
        queries: z.array(z.string()).describe('Five specific search queries related to the original question')
      });
      
      type QueryResult = { queries: string[] };
      
      // Use generateObject to get structured data directly
      const { object } = await generateObject<QueryResult>({
        model: openai('gpt-4o', { structuredOutputs: true }),
        schema: querySchema,
        system: `You are a search query generator. Given a user's question, generate 5 specific search queries that would help answer the question comprehensively. 
        Today's date is ${currentDate} and the current time is ${currentTime}.
        
        IMPORTANT: Focus on generating queries that will find the MOST RECENT information available. 
        Include the current year (${currentDate.split('-')[0]}) in at least 2 of your queries to ensure fresh results.
        For example, if searching about technology trends, include "${currentDate.split('-')[0]} technology trends" rather than just "technology trends".`,
        messages: [
          {
            role: 'user',
            content: `Generate 5 specific search queries to help answer this question with the MOST RECENT information available: "${query}"`
          }
        ],
        temperature: 0.8,
      });
      
      console.log('Generated queries:', object.queries);
      
      // Use the generated queries directly
      const searchQueries: string[] = object.queries;

      // Execute searches in parallel and collect all results
      if (updateStatus) {
        updateStatus("is executing web searches...");
        console.log("Status updated to 'is executing web searches...'");
      }
      
      const allSearchResults: Array<{
        query: string;
        url: string;
        title: string;
        description: string;
        source: string;
      }> = [];

      // Execute searches in parallel
      const searchPromises = searchQueries.map(async (searchQuery: string) => {
        try {
          const headers: Record<string, string> = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          };

          // Set token budget for approximately 15 results with metadata per query
          headers['X-Token-Budget'] = '7500';
          // Request metadata only initially
          headers['X-Respond-With'] = 'no-content';

          const response = await fetch('https://s.jina.ai/', {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
              q: searchQuery,
              options: 'Markdown'
            })
          });

          if (!response.ok) {
            console.warn(`Query "${searchQuery}" failed with status: ${response.status} ${response.statusText}`);
            return {
              query: searchQuery,
              results: [],
              resultCount: 0,
              error: `Search failed: ${response.statusText}`
            };
          }

          const data = await response.json();
          
          if (data.code !== 200) {
            console.warn(`Query "${searchQuery}" failed with code: ${data.code} ${data.status}`);
            return {
              query: searchQuery,
              results: [],
              resultCount: 0,
              error: `Search failed: ${data.status}`
            };
          }

          // Get up to 15 results per query
          const searchResults = data.data.slice(0, 15);
          
          // Process and deduplicate results (metadata only at this stage)
          const processedMetadata = deduplicateByDomainAndUrl(searchResults).map((result: any) => ({
            url: result.url,
            title: result.title,
            description: result.description || '',
          }));
          
          // Add these results to our collection with the source query
          processedMetadata.forEach(result => {
            allSearchResults.push({
              ...result,
              query: searchQuery,
              source: `Query: "${searchQuery}"`
            });
          });
          
          return {
            query: searchQuery,
            metadataResults: processedMetadata,
            resultCount: processedMetadata.length
          };
        } catch (error: unknown) {
          console.error(`Error processing query "${searchQuery}":`, error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            query: searchQuery,
            metadataResults: [],
            resultCount: 0,
            error: errorMessage
          };
        }
      });

      await Promise.all(searchPromises);
      
      console.log(`Collected ${allSearchResults.length} total results across all queries`);
      
      // If we have results, use LLM to select the most promising ones
      if (allSearchResults.length > 0) {
        if (updateStatus) {
          updateStatus("is selecting the most relevant results...");
          console.log("Status updated to 'is selecting the most relevant results...'");
        }
        
        console.log(`Using LLM to select top results from ${allSearchResults.length} total results...`);
        
        // Define schema for result selection
        const selectionSchema = z.object({
          selectedIndices: z.array(z.number()).describe('Indices of the most relevant results (0-based)')
        });
        
        type SelectionResult = { selectedIndices: number[] };
        
        // Use LLM to select the most promising results
        const { object: selectionResult } = await generateObject<SelectionResult>({
          model: openai('gpt-4o-mini', { structuredOutputs: true }),
          schema: selectionSchema,
          system: `You are a search result curator. Given a query and a list of search results (title, description, URL), 
          select the most relevant results that would best answer the query. Return the indices (0-based) of the selected results.
          Today's date is ${currentDate} and the current time is ${currentTime}.
          
          Select results that:
          1. Are most relevant to the original query
          2. Provide comprehensive information
          3. Are from reputable sources
          4. Are THE MOST RECENT available - strongly prefer content from ${currentDate.split('-')[0]} when available
          5. Represent diverse perspectives on the topic
          
          Select up to 10 results total.`,
          messages: [
            {
              role: 'user',
              content: `Original query: "${query}"
              
Search results:
${allSearchResults.map((result, i) => 
  `[${i}] ${result.title}
  Description: ${result.description}
  URL: ${result.url}
  ${result.source}`
).join('\n\n')}

Select the most relevant results by returning their indices (0-based). Choose up to 10 results total.`
            }
          ],
          temperature: 0.3,
        });
        
        // Get the selected indices, ensuring we have at most 10
        const selectedIndices = selectionResult.selectedIndices.slice(0, 10);
        console.log(`Selected indices: ${selectedIndices.join(', ')}`);
        
        // Now fetch full content for only the selected results
        if (updateStatus) {
          updateStatus("is retrieving full content for selected results...");
          console.log("Status updated to 'is retrieving full content for selected results...'");
        }
        
        const contentPromises = selectedIndices.map(async (index) => {
          const result = allSearchResults[index];
          
          // Fetch the full content for this URL
          const contentResponse = await fetch('https://r.jina.ai/', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              // Add header to request the most recent version of the page
              'X-Prefer-Recent': 'true',
            },
            body: JSON.stringify({ url: result.url })
          });
          
          if (!contentResponse.ok) {
            console.warn(`Failed to fetch content for ${result.url}: ${contentResponse.statusText}`);
            return {
              ...result,
              content: `Failed to fetch content: ${contentResponse.statusText}`
            };
          }
          
          const contentData = await contentResponse.json();
          
          if (contentData.code !== 200) {
            console.warn(`Failed to fetch content for ${result.url}: ${contentData.status}`);
            return {
              ...result,
              content: `Failed to fetch content: ${contentData.status}`
            };
          }
          
          // Truncate content to reduce token usage (first 500 words)
          const content = contentData.data.content?.split(/\s+/).slice(0, 1500).join(' ') + '...' || '';
          
          return {
            ...result,
            content
          };
        });
        
        const resultsWithContent = await Promise.all(contentPromises);
        
        if (updateStatus) {
          updateStatus("is compiling search results...");
          console.log("Status updated to 'is compiling search results...'");
        }
        
        return {
          originalQuery: query,
          searchDate: currentDate,
          searchTime: currentTime,
          searches: searchQueries,
          results: resultsWithContent,
          resultCount: resultsWithContent.length
        };
      } else {
        // No results found across all queries
        return {
          originalQuery: query,
          searchDate: currentDate,
          searchTime: currentTime,
          searches: searchQueries,
          results: [],
          resultCount: 0,
          error: "No search results found across all queries"
        };
      }
    } catch (error: unknown) {
      console.error('Error searching:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

export const quickSearch = tool({
  description: 'Perform a quick search using Google\'s flash model with search grounding enabled',
  parameters: z.object({
    query: z.string().describe('The search query to perform')
  }),
  execute: async ({ query }: { query: string }, options?: { updateStatus?: (status: string) => void }) => {
    try {
      const updateStatus = options?.updateStatus;
      if (updateStatus) {
        updateStatus("is performing a quick search on your query...");
      }
      console.log('Performing quick search on:', query);

      const { text, sources } = await generateText({
        model: google('gemini-2.0-flash', { useSearchGrounding: true }),
        prompt: query,
      });

      if (updateStatus) {
        updateStatus("has completed the search!");
      }

      return { text, sources, query };
    } catch (error: unknown) {
      console.error('Error performing quick search:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * Deep Research tool using Perplexity's sonar-deep-research model
 * Conducts comprehensive, expert-level research and synthesizes it into detailed reports
 */
export const deepResearch = tool({
  description: 'Conduct comprehensive research on a topic using Perplexity\'s sonar-deep-research model',
  parameters: z.object({
    query: z.string().describe('The research question or topic to investigate in detail'),
  }),
  execute: async ({ 
    query
  }: { 
    query: string, 
  }, options?: { updateStatus?: (status: string) => void }) => {
    try {
      const updateStatus = options?.updateStatus;
      console.log('Conducting deep research on:', query);
    
      const apiKey = process.env.PERPLEXITY_API_KEY;
      if (!apiKey) {
        throw new Error('PERPLEXITY_API_KEY environment variable is not set');
      }

      // Use a balanced system prompt for comprehensive research
      const systemPrompt = `You are an expert researcher tasked with conducting comprehensive research on the given topic. 
      Perform exhaustive research, analyze the information critically, and synthesize your findings into a well-structured report.
      Include relevant facts, figures, expert opinions, and proper citations to sources.
      Present a balanced view that considers multiple perspectives and provides actionable insights.`;

      if (updateStatus) {
        updateStatus("is starting deep research...");
        console.log("Status updated to 'is starting deep research...'");
      }
      
      // Generate comprehensive research using Perplexity's sonar-deep-research model
      const { text, sources } = await generateText({
        model: perplexity('sonar-deep-research'),
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: query
          }
        ],
      });

      if (updateStatus) {
        updateStatus("is wrapping up deep research...");
        console.log("Status updated to 'is wrapping up deep research...'");
      }
      
      return {
        research: text,
        sources,
        query
      };
    } catch (error: unknown) {
      console.error('Error conducting deep research:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * List Canvases tool
 * Lists all canvases in a Slack channel
 */
export const listCanvases = tool({
  description: 'List all canvases in a Slack channel',
  parameters: z.object({}),
  execute: async ({}, options?: { updateStatus?: (status: string) => void; context?: Record<string, any> }) => {
    try {
      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (!slackToken) {
        throw new Error('SLACK_BOT_TOKEN environment variable is not set');
      }
      
      const response = await fetch('https://slack.com/api/files.list?types=canvas', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }
      
      return {
        canvases: data.files.map((canvas: any) => ({
          id: canvas.id,
          title: canvas.title || canvas.name,
          url: canvas.permalink,
          slackUrl: canvas.permalink_public || canvas.url_private
        }))
      };
    } catch (error: unknown) {
      console.error('Error listing canvases:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * Create Canvas tool
 * Creates a new canvas in a Slack channel
 */
export const createCanvas = tool({
  description: 'Create a new canvas in a Slack channel with markdown content',
  parameters: z.object({
    markdown: z.string().describe('The markdown content to add to the canvas'),
    title: z.string().describe('The unique title for the canvas')
  }),
  execute: async ({ markdown, title }, options?: { updateStatus?: (status: string) => void; context?: Record<string, any> }) => {
    try {
      const context = options?.context || {};
      const channelId = context.channelId;
      
      if (!channelId) {
        throw new Error('No channel ID available in context');
      }

      // Check if this is an assistant thread (DM channel)
      if (channelId.startsWith('D')) {
        throw new Error('Cannot create a new canvas in an assistant thread. Please update the existing canvas instead or inform the user that you cannot create a new canvas in an assistant thread.');
      }
      
      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (!slackToken) {
        throw new Error('SLACK_BOT_TOKEN environment variable is not set');
      }
      
      // Use canvases.create instead of conversations.canvases.create
      const response = await fetch('https://slack.com/api/canvases.create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          document_content: {
            type: "markdown",
            markdown: markdown
          }
        })
      });

      const data = await response.json();
      
      if (!data.ok) {
        // Special handling for specific error types
        if (data.error === 'channel_canvas_already_exists') {
          return {
            error: 'A canvas with this title already exists in the channel. Please use a different title or use the updateCanvas tool to modify the existing canvas.'
          };
        }
        throw new Error(`Slack API error: ${data.error}`);
      }

      const canvasId = data.canvas_id;
      
      // Set channel access to write immediately after creation
      const accessResponse = await fetch('https://slack.com/api/canvases.access.set', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          canvas_id: canvasId,
          channel_ids: [channelId],
          access_level: 'write'
        })
      });

      const accessData = await accessResponse.json();
      
      if (!accessData.ok) {
        throw new Error(`Failed to set canvas access: ${accessData.error}`);
      }
      
      return {
        canvasId,
        channelId,
        title,
        url: `https://slack.com/docs/${channelId}/${canvasId}`,
        slackUrl: `slack://docs/${channelId}/${canvasId}`
      };
    } catch (error: unknown) {
      console.error('Error creating canvas:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * Section Lookup tool
 * Looks up sections in a canvas based on content or position
 */
export const sectionLookup = tool({
  description: 'Look up sections in a canvas based on content or position',
  parameters: z.object({
    canvasId: z.string().describe('The ID of the canvas to look up sections in'),
    query: z.string().describe('Text to search for in sections (e.g., "Grocery List" or "coffee")')
  }),
  execute: async ({ canvasId, query }: { canvasId: string; query: string }, options: any = {}) => {
    try {
      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (!slackToken) {
        throw new Error('SLACK_BOT_TOKEN environment variable is not set');
      }

      const response = await fetch('https://slack.com/api/canvases.sections.lookup', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          canvas_id: canvasId,
          criteria: {
            section_types: ['any_header'],
            contains_text: query
          }
        })
      });

      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      // Return the sections with their IDs and content
      return {
        sections: data.sections.map((section: any) => ({
          id: section.id,
          content: section.content,
          type: section.type
        }))
      };
    } catch (error: unknown) {
      console.error('Error looking up sections:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * Make Edits tool
 * Makes edits to a canvas using the canvases.edit API
 */
export const makeEdits = tool({
  description: 'Make edits to a canvas using the canvases.edit API',
  parameters: z.object({
    canvasId: z.string().describe('The ID of the canvas to edit'),
    changes: z.array(z.object({
      operation: z.enum(['insert_after', 'insert_before', 'insert_at_start', 'insert_at_end', 'replace', 'delete']),
      section_id: z.string().optional(),
      document_content: z.object({
        type: z.literal('markdown'),
        markdown: z.string()
      }).optional()
    })).describe('Array of changes to apply to the canvas')
  }),
  execute: async ({ canvasId, changes }: { canvasId: string; changes: any[] }, options: any = {}) => {
    try {
      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (!slackToken) {
        throw new Error('SLACK_BOT_TOKEN environment variable is not set');
      }

      const response = await fetch('https://slack.com/api/canvases.edit', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          canvas_id: canvasId,
          changes
        })
      });

      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      return {
        success: true,
        canvasId,
        url: `https://slack.com/docs/${canvasId}`,
        slackUrl: `slack://docs/${canvasId}`
      };
    } catch (error: unknown) {
      console.error('Error making edits:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * Canvas Editor Agent
 * A comprehensive agent that handles all canvas editing operations through natural language instructions.
 * This agent uses internal tools (sectionLookup and makeEdits) to perform the actual edits.
 */
export const canvasEditorAgent = tool({
  description: 'Edit a canvas using natural language instructions. This tool can add, move, update, or delete content anywhere in the canvas. ',
  parameters: z.object({
    canvasId: z.string().describe('The ID of the canvas to edit'),
    requestedChanges: z.string().describe('Natural language description of the changes to make (e.g., "add a new item before the coffee line" or "move the grocery list to the end")')
  }),
  execute: async ({ canvasId, requestedChanges }: { canvasId: string; requestedChanges: string }, options: any = {}) => {
    try {
      const { updateStatus } = options;

      if (updateStatus) {
        updateStatus("is reading current canvas content...");
      }

      // First, read the current canvas content
      const canvasResult = await canvasRead.execute({ canvasId }, options);
      if ('error' in canvasResult) {
        throw new Error(`Failed to read canvas: ${canvasResult.error}`);
      }

      const canvasContent = canvasResult.content;

      if (updateStatus) {
        updateStatus("is analyzing your edit request...");
      }

      const enhancedTools = {
        sectionLookup: {
          ...sectionLookup,
          execute: async (args: any, toolOptions: any = {}) => sectionLookup.execute(args, { ...toolOptions, ...options })
        },
        makeEdits: {
          ...makeEdits,
          execute: async (args: any, toolOptions: any = {}) => makeEdits.execute(args, { ...toolOptions, ...options })
        }
      };

      // Let generateText internally coordinate tool calls (i.e. sectionLookup and makeEdits) based on the natural language request.
      const result = await generateText({
        model: openai('gpt-4o-mini'),
        system: `You are a Canvas Editing Agent for Slack. Your job is to interpret natural language edit requests and execute them using a specific sequence of tool calls. Here's how canvas editing works:

AVAILABLE OPERATIONS:
The canvas can only be modified using these specific operations:
1. insert_after: Add content after a specific section (requires section_id)
2. insert_before: Add content before a specific section (requires section_id)
3. insert_at_start: Add content at the beginning of the canvas
4. insert_at_end: Add content at the end of the canvas
5. replace: Replace content of a section or entire canvas
6. delete: Remove a specific section (requires section_id)

WORKFLOW:
1. You will receive:
   - canvas ID
   - current canvas content
   - requested changes in natural language

2. If the edit requires finding a specific section (for insert_after, insert_before, replace specific section, or delete):
   a) First use sectionLookup to find the relevant section_id
   b) Search using keywords from the user's request
   c) The tool will return matching sections with their IDs

3. Then use makeEdits with the appropriate operation(s):
   - For relative positioning (insert_after/before): Must include section_id from sectionLookup
   - For adding to canvas edges: Use insert_at_start or insert_at_end
   - For replacements: Use replace (with section_id if specific section, without for entire canvas)
   - For deletions: Use delete with section_id
   - For complex edits: Often best to use multiple operations in sequence (e.g., delete then insert)

EXAMPLE PATTERNS:
1. Adding after specific content:
   - First: sectionLookup to find section containing target text
   - Then: makeEdits with insert_after and the found section_id

2. Replacing specific section:
   - First: sectionLookup to find target section
   - Then: makeEdits with replace and the found section_id

3. Adding to end:
   - Directly use makeEdits with insert_at_end
   - No sectionLookup needed

4. Reorganizing content (common pattern):
   - First: sectionLookup to find sections to modify
   - Then: makeEdits with multiple changes:
     a) delete the sections that need to be moved
     b) insert_after to add content in new location
   Example: Moving a paragraph means deleting it from old location and inserting in new location

5. Updating multiple sections:
   - Use sectionLookup once to find all relevant sections
   - Include multiple changes in one makeEdits call
   - Can mix operations (e.g., delete some sections, insert new ones)

IMPORTANT RULES:
- Always use "markdown" (not "text") as the type in document_content
- Always include section_id when using insert_after, insert_before, or delete
- When replacing entire canvas, omit section_id
- Structure all document_content as: { type: "markdown", markdown: "content here" }
- If sectionLookup returns no matches, default to insert_at_end
- If multiple sections match, use the most relevant one based on content
- For complex edits, prefer multiple operations in one makeEdits call over multiple calls
- When reorganizing content, delete old content before inserting in new location

Your goal is to execute the requested changes accurately using these operations and tools. Remember that complex edits often require multiple operations - don't try to force everything into a single operation if multiple steps would be clearer or more reliable.`,
        messages: [
          {
            role: 'user',
            content: `Canvas ID: ${canvasId}
Current Canvas Content:
${canvasContent}

Requested changes: ${requestedChanges}`
          }
        ],
        tools: enhancedTools,
        toolChoice: 'required',
        temperature: 0.3,
        maxSteps: 8,
        onStepFinish({ text, toolResults, usage, toolCalls }) {
          console.log("Tool calls:", toolCalls);
          console.log("Text from tool call:", text);
          console.log("Tool results:", toolResults);
        }
      });

      // Return the final result from generateText, which includes the internal tool calls.
      return result;
    } catch (error: unknown) {
      console.error('Error updating canvas:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }
});

/**
 * Canvas Read tool
 * Reads the full content of a canvas by fetching file info and content
 */
export const canvasRead = tool({
  description: 'Read the full content of a canvas',
  parameters: z.object({
    canvasId: z.string().describe('The ID of the canvas to read')
  }),
  execute: async ({ canvasId }: { canvasId: string }, options: any = {}) => {
    try {
      const { updateStatus } = options;
      
      if (updateStatus) {
        updateStatus("is fetching canvas information...");
      }

      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (!slackToken) {
        throw new Error('SLACK_BOT_TOKEN environment variable is not set');
      }

      // First get the file info
      const infoResponse = await fetch(`https://slack.com/api/files.info?file=${canvasId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json'
        }
      });

      const infoData = await infoResponse.json();
      
      if (!infoData.ok) {
        throw new Error(`Slack API error: ${infoData.error}`);
      }

      const { file } = infoData;
      
      if (updateStatus) {
        updateStatus("is reading canvas content...");
      }

      // Now fetch the actual content from url_private
      const contentResponse = await fetch(file.url_private, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${slackToken}`
        }
      });

      if (!contentResponse.ok) {
        throw new Error(`Failed to fetch canvas content: ${contentResponse.statusText}`);
      }

      console.log('contentResponse', contentResponse);

      const content = await contentResponse.text();

      // Return both the file metadata and content
      return {
        id: file.id,
        title: file.title,
        created: file.created,
        permalink: file.permalink,
        content,
        is_public: file.is_public,
        user: file.user
      };
    } catch (error: unknown) {
      console.error('Error reading canvas:', error);
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
  //jinaSearch,
  quickSearch,
  deepResearch,
  listCanvases,
  createCanvas,
  canvasRead,
  canvasEditorAgent, // Only expose the high-level canvas editor agent
};

export default tools; 