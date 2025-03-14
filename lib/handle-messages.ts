import type {
  AssistantThreadStartedEvent,
  GenericMessageEvent,
} from "@slack/web-api";
import { client, getThread, updateStatusUtil, sendUnifiedMessage } from "./slack-utils";
import { generateResponse } from "./generate-response";

export async function assistantThreadMessage(
  event: AssistantThreadStartedEvent,
) {
  const { channel_id, thread_ts } = event.assistant_thread;
  console.log(`Thread started: ${channel_id} ${thread_ts}`);
  console.log(`IMPORTANT - The correct channel ID for this thread is: ${channel_id}`);
  console.log(JSON.stringify(event));

  // Create context with channel information - this won't be used yet, but for consistency
  const context = {
    channelId: channel_id,
    threadTs: thread_ts
  };
  console.log("Thread started with context:", context);

  await sendUnifiedMessage({
    channel: channel_id,
    threadTs: thread_ts,
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
        message: "Create a canvas about the latest developments in AI technology in late 2024 and early 2025.",
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

  // Create context with channel information
  const context = {
    channelId: channel,
    threadTs: thread_ts
  };
  console.log("Assistant message context:", context);

  const messages = await getThread(channel, thread_ts, botUserId);
  const result = await generateResponse(messages, updateStatus, context);

  await sendUnifiedMessage({
    channel,
    threadTs: thread_ts,
    text: result,
    updateStatus,
    context,
  });
}
