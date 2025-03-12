import type {
  AssistantThreadStartedEvent,
  GenericMessageEvent,
} from "@slack/web-api";
import { client, getThread, updateStatusUtil } from "./slack-utils";
import { generateResponse } from "./generate-response";

export async function assistantThreadMessage(
  event: AssistantThreadStartedEvent,
) {
  const { channel_id, thread_ts } = event.assistant_thread;
  console.log(`Thread started: ${channel_id} ${thread_ts}`);
  console.log(JSON.stringify(event));

  await client.chat.postMessage({
    channel: channel_id,
    thread_ts: thread_ts,
    text: "Hello, I'm an AI assistant built with the AI SDK by Vercel!",
  });

  await client.assistant.threads.setSuggestedPrompts({
    channel_id: channel_id,
    thread_ts: thread_ts,
    prompts: [
      {
        title: "Search the web",
        message: "What are the latest developments in AI technology in 2024?",
      },
      {
        title: "Scrape a webpage",
        message: "What are the strengths and weaknesses of our landing page? https://www.servant.io",
      },
      {
        title: "Research a topic",
        message: "Ask me clarifying questions to research this query: Conduct a comprehensive research on the market size for AI consultants in 2025.",
      },
    ],
  });
}

export async function handleNewAssistantMessage(
  event: GenericMessageEvent,
  botUserId: string,
) {
  if (
    event.bot_id ||
    event.bot_id === botUserId ||
    event.bot_profile ||
    !event.thread_ts
  )
    return;

  const { thread_ts, channel } = event;
  const updateStatus = updateStatusUtil(channel, thread_ts);
  updateStatus("is thinking...");

  const messages = await getThread(channel, thread_ts, botUserId);
  const result = await generateResponse(messages, updateStatus);

  // Slack has a 3000 character limit for a single text block
  const SLACK_CHAR_LIMIT = 3000;
  
  // Check if this is likely a deep research result (long text)
  const isLongResearchResult = result.length > SLACK_CHAR_LIMIT && 
    (result.includes("research") || messages.some(m => m.content.toString().includes("research")));
  
  if (isLongResearchResult) {
    try {
      // Check if canvas creation is available by checking if the canvases API exists
      // and if the bot has the necessary permissions
      let canvasCreationAvailable = false;
      
      try {
        // Try to check if we have canvas permissions
        if (client.canvases) {
          // Just check if the API is available, don't actually create a canvas yet
          console.log("Canvas API is available, will attempt to use it");
          canvasCreationAvailable = true;
        }
      } catch (e) {
        console.log("Canvas API not available:", e);
        canvasCreationAvailable = false;
      }
      
      if (canvasCreationAvailable) {
        // Create a canvas for the research result
        updateStatus("is preparing research canvas...");
        
        // Extract a title from the first few lines of the result
        const firstLineBreak = result.indexOf('\n');
        const potentialTitle = firstLineBreak > 0 
          ? result.substring(0, Math.min(firstLineBreak, 100)).trim() 
          : "Research Report";
        
        const title = potentialTitle.replace(/^#+\s*/, ''); // Remove markdown heading symbols if present
        
        // Create the canvas with the research content
        const canvasResponse = await client.canvases.create({
          title: title,
          document_content: {
            type: "markdown",
            markdown: result
          }
        });
        
        if (!canvasResponse.ok) {
          throw new Error(`Failed to create canvas: ${canvasResponse.error}`);
        }
        
        const canvasId = canvasResponse.canvas_id;
        
        // Send a message with a link to the canvas
        // Slack will automatically unfurl the canvas when shared in a message
        await client.chat.postMessage({
          channel: channel,
          thread_ts: thread_ts,
          text: `I've prepared a detailed research report for you. View the full report here: <https://slack.com/docs/canvas/${canvasId}|${title}>`,
          unfurl_links: true,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `I've prepared a detailed research report for you. View the full report here: <https://slack.com/docs/canvas/${canvasId}|${title}>`
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Summary:* ${result.substring(0, Math.min(200, result.length))}...`
              }
            }
          ]
        });
        
        console.log(`Created canvas for research result with ID: ${canvasId}`);
      } else {
        // Canvas creation not available, truncate the message
        console.log("Canvas creation not available, truncating message");
        const truncatedResult = result.substring(0, SLACK_CHAR_LIMIT - 100) + 
          "\n\n[Message truncated due to length. Canvas creation not available.]";
        
        await client.chat.postMessage({
          channel: channel,
          thread_ts: thread_ts,
          text: truncatedResult,
          unfurl_links: false,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: truncatedResult,
              },
            },
          ],
        });
      }
    } catch (error) {
      console.error("Error creating canvas:", error);
      
      // Truncate the message if canvas creation fails
      console.log("Truncating message due to canvas creation failure");
      const truncatedResult = result.substring(0, SLACK_CHAR_LIMIT - 100) + 
        "\n\n[Message truncated due to length. Canvas creation failed.]";
      
      await client.chat.postMessage({
        channel: channel,
        thread_ts: thread_ts,
        text: truncatedResult,
        unfurl_links: false,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: truncatedResult,
            },
          },
        ],
      });
    }
  } else {
    // For regular messages, send as a single message
    // If it's too long, truncate it
    let messageText = result;
    if (result.length > SLACK_CHAR_LIMIT) {
      messageText = result.substring(0, SLACK_CHAR_LIMIT - 100) + 
        "\n\n[Message truncated due to length. Consider using research queries for longer responses.]";
    }
    
    await client.chat.postMessage({
      channel: channel,
      thread_ts: thread_ts,
      text: messageText,
      unfurl_links: false,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: messageText,
          },
        },
      ],
    });
  }

  updateStatus("");
}
