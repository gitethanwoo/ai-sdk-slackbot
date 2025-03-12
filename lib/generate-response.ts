import { openai } from '@ai-sdk/openai';
import { CoreMessage, generateText } from 'ai';
import { tools } from './tools';

export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
) => {
  try {
    console.log("Starting response generation");
    
    if (updateStatus) {
       updateStatus("is thinking...");
      console.log("Status updated to 'Processing your request...'");
    }
    
    // Create enhanced versions of the tools with the updateStatus function
    const enhancedTools = Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => {
        // If we don't have updateStatus, just return the original tool
        if (!updateStatus) return [name, tool];
        
        // Create a new tool with the same properties but with options.updateStatus
        return [
          name,
          {
            ...tool,
            execute: async (args: any, options: any = {}) => {
              // Call the original execute with the updateStatus function
              return tool.execute(args, { 
                ...options, 
                updateStatus 
              });
            }
          }
        ];
      })
    );
    
    const { text } = await generateText({
      model: openai('gpt-4o'), //this is fine - do not change. this is a new spec not in the docs yet
      system: `You are a helpful Slack bot assistant. Keep your responses concise and to the point. Before doing deep research, you should ask clarifying questions. 

CURRENT DATE: ${new Date().toISOString().split('T')[0]}

AVAILABLE TOOLS:
1. webScrape - Use this tool when you need to extract detailed information from a specific webpage. Provide the exact URL.
   - Best for: When the user mentions a specific URL they want information from
   - Example: "Can you summarize the content at https://example.com/article"
   - Example: "What does this webpage say about X: https://example.com/page"

2. jinaSearch - Use this tool when you need to search the web for current information. This tool generates multiple related search queries to find comprehensive information.
   - Best for: General information queries, current events, or when you need to find multiple sources
   - Example: "What are the latest developments in AI regulation?"
   - Example: "Who won the most recent championship?"
   - Example: "What's happening with the economy right now?"
   - Note: Always include sources from the search results in your final response

3. deepResearch - Use this tool for complex topics requiring in-depth analysis. It uses Perplexity's sonar-deep-research model to provide comprehensive research.
   - Best for: Complex questions, academic topics, or when detailed analysis is requested
   - Example: "Explain the implications of quantum computing on cryptography"
   - Example: "What are the different approaches to solving climate change?"
   - Example: "Compare and contrast different economic theories"
   - Note: This tool takes longer but provides more thorough information

TOOL SELECTION GUIDELINES:
- For simple questions you can answer directly, don't use any tools
- For factual questions about current events or recent information, use jinaSearch
- For questions about specific websites or articles, use webScrape
- For complex questions requiring in-depth analysis, use deepResearch
- When uncertain about information accuracy or recency, use jinaSearch to verify
- Only use one tool per response unless absolutely necessary

RESPONSE FORMATTING:
- Keep responses concise and focused
- Format lists with bullet points
- Do not tag users
- Always include sources when using web search tools
- Convert markdown links to Slack format in your final response

Remember to maintain a helpful, professional tone while being conversational and engaging.`,
      messages,
      maxSteps: 10,
      tools: enhancedTools,
      onStepFinish({ toolResults }) {
        // When all tool results are in, update status to indicate we're finalizing the response
        if (updateStatus && toolResults && toolResults.length > 0) {
          updateStatus("is finalizing response...");
          console.log("Status updated to 'is finalizing response...'");
        }
      }
    });
    
    // Convert markdown to Slack mrkdwn format
    const formattedText = text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');
    console.log("Formatting complete, returning response");
    return formattedText;
  } catch (error) {
    console.error("Error generating response:", error);
    throw error; // Re-throw to be handled by the caller
  }
};