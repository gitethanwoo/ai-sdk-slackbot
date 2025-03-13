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
        message: "What are the latest developments in AI technology in late 2024 and early 2025?",
      },
      {
        title: "Scrape a webpage",
        message: "What are the strengths and weaknesses of our landing page? https://www.servant.io",
      },
      {
        title: "Research a topic",
        message: "Ask me clarifying questions to research this query: Conduct a comprehensive research on the market size for AI consultants in 2025.",
      },
      {
        title: "Create a canvas",
        message: "Create a detailed Slack canvas summarizing the latest developments in AI technology in late 2024 and early 2025, including key trends and breakthroughs.",
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
  const result = await generateResponse(messages, updateStatus, channel);

  // Slack has a 40,000 character limit for the overall message text
  const SLACK_TEXT_LIMIT = 40000;
  
  // Handle message length - truncate if necessary
  let messageText = result;
  if (result.length > SLACK_TEXT_LIMIT) {
    messageText = result.substring(0, SLACK_TEXT_LIMIT - 100) + 
      "\n\n[Message truncated due to length. Consider breaking your query into smaller parts.]";
  }
  
  // Section blocks have a 3000 character limit
  const SECTION_BLOCK_LIMIT = 3000;
  
  // Split the message into chunks of ~3000 characters, breaking at word boundaries
  const blocks = [];
  let startIndex = 0;
  
  while (startIndex < messageText.length) {
    // If we're near the end of the message, just take the rest
    if (startIndex + SECTION_BLOCK_LIMIT >= messageText.length) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: messageText.substring(startIndex),
        },
        expand: true
      });
      break;
    }
    
    // Find the last space before the 3000 character limit
    let endIndex = startIndex + SECTION_BLOCK_LIMIT;
    
    // Look for the last space within the limit
    const lastSpaceIndex = messageText.lastIndexOf(' ', endIndex);
    
    // If we found a space within a reasonable distance, use it
    if (lastSpaceIndex > startIndex && lastSpaceIndex > endIndex - 100) {
      endIndex = lastSpaceIndex;
    }
    // Otherwise, we'll just cut at the character limit (rare case with very long words)
    
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: messageText.substring(startIndex, endIndex),
      },
      expand: true
    });
    
    // Start the next chunk after the space
    startIndex = endIndex + 1;
  }
  
  await client.chat.postMessage({
    channel: channel,
    thread_ts: thread_ts,
    text: messageText, // Fallback text
    unfurl_links: false,
    blocks: blocks,
  });

  updateStatus("");
}
