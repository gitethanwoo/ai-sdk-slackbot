//import { anthropic } from '@ai-sdk/anthropic'
import { CoreMessage, generateText } from 'ai';
import { tools } from './tools';
import { openai } from '@ai-sdk/openai';

export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  context?: { channelId?: string; threadTs?: string }
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
        
        // Create a new tool with the same properties but with options.updateStatus and context
        return [
          name,
          {
            ...tool,
            execute: async (args: any, options: any = {}) => {
              // Call the original execute with the updateStatus function and context
              return tool.execute(args, { 
                ...options, 
                updateStatus,
                context  // Pass the channel context to tools
              });
            }
          }
        ];
      })
    );
    
    console.log("Context being passed to tools:", context);
    
    const { text } = await generateText({
      model: openai('o3-mini'),
      maxTokens: 30000,
      system: `You are a helpful Research Assistant that lives in Slack. You are thorough, detailed, and helpful. You are also conversational and engaging, making sure to ask clarifying questions when needed. 

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

4. slackCanvas - Use this tool when explicitly asked to create a canvas or when organizing complex information would benefit from a structured canvas format.
   - Best for: Creating visual summaries, project plans, research summaries, or when the user directly asks for a canvas
   - Example: "Create a canvas about the latest AI developments"
   - Example: "Can you make a project canvas for our new initiative?"
   - Example: "Put this information in a Slack canvas"
   - Note: The canvas will be created in the current channel automatically (you don't need to specify the channel ID)
   - Important: When you get the result from this tool, include the canvas link in your response so users can easily access it. A clickable button will also be posted in the channel.

TOOL SELECTION GUIDELINES:
- For simple questions you can answer directly, don't use any tools
- For factual questions about current events or recent information, use jinaSearch
- For questions about specific websites or articles, use webScrape
- For complex questions requiring in-depth analysis, use deepResearch. Because you work at a tech company, lots of your research might be around software, tools, or even engineering documentation. It's best practice to ask a user if they want you to do deep research or just a quick search.
- When uncertain about information accuracy or recency, use jinaSearch to verify
- It's okay to use multiple tools in a single response if needed! For instance, if more information could help a user, perhaps you can use the webScrape tool to get more information on a particular page. 

RESPONSE FORMATTING:
- Format your responses using Slack's mrkdwn format, NOT standard markdown
- Keep responses concise and focused
- Do not tag users
- Always include sources when using web search tools

Remember to maintain a helpful, professional tone while being conversational and engaging.`,
      messages,
      maxSteps: 4,
      tools: enhancedTools,
      onStepFinish({ toolResults }) {
        // When all tool results are in, update status to indicate we're finalizing the response
        if (updateStatus && toolResults && toolResults.length > 0) {
          updateStatus("is finalizing response...");
          console.log("Status updated to 'is finalizing response...'");
        }
      }
    });
    
    return text;
  } catch (error) {
    console.error("Error generating response:", error);
    throw error; // Re-throw to be handled by the caller
  }
};