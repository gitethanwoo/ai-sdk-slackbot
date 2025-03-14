import { WebClient } from '@slack/web-api';
import { CoreMessage } from 'ai'
import crypto from 'crypto'

const signingSecret = process.env.SLACK_SIGNING_SECRET!

export const client = new WebClient(process.env.SLACK_BOT_TOKEN);

// See https://api.slack.com/authentication/verifying-requests-from-slack
export async function isValidSlackRequest({
  request,
  rawBody,
}: {
  request: Request
  rawBody: string
}) {
  // console.log('Validating Slack request')
  const timestamp = request.headers.get('X-Slack-Request-Timestamp')
  const slackSignature = request.headers.get('X-Slack-Signature')
  // console.log(timestamp, slackSignature)

  if (!timestamp || !slackSignature) {
    console.log('Missing timestamp or signature')
    return false
  }

  // Prevent replay attacks on the order of 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 60 * 5) {
    console.log('Timestamp out of range')
    return false
  }

  const base = `v0:${timestamp}:${rawBody}`
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(base)
    .digest('hex')
  const computedSignature = `v0=${hmac}`

  // Prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(slackSignature)
  )
}

export const verifyRequest = async ({
  requestType,
  request,
  rawBody,
}: {
  requestType: string;
  request: Request;
  rawBody: string;
}) => {
  const validRequest = await isValidSlackRequest({ request, rawBody });
  if (!validRequest || requestType !== "event_callback") {
    return new Response("Invalid request", { status: 400 });
  }
};

export const updateStatusUtil = (channel: string, thread_ts: string) => {
  return async (status: string) => {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: thread_ts,
      status: status,
    });
  };
};

// Constants for message limits
const SLACK_TEXT_LIMIT = 40000;
const SECTION_BLOCK_LIMIT = 3000;

interface UnifiedMessageOptions {
  channel: string;
  threadTs?: string;
  text: string;
  updateStatus?: (status: string) => void;
  context?: Record<string, any>;
  isAssistantMessage?: boolean;
}

// Unified message handler that works for both regular and assistant messages
export async function sendUnifiedMessage({
  channel,
  threadTs,
  text,
  updateStatus,
  context,
  isAssistantMessage = false
}: UnifiedMessageOptions) {
  // Handle message length - truncate if necessary
  let messageText = text;
  if (text.length > SLACK_TEXT_LIMIT) {
    messageText = text.substring(0, SLACK_TEXT_LIMIT - 100) + 
      "\n\n[Message truncated due to length. Consider breaking your query into smaller parts.]";
  }
  
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
    const lastSpaceIndex = messageText.lastIndexOf(' ', endIndex);
    
    // If we found a space within a reasonable distance, use it
    if (lastSpaceIndex > startIndex && lastSpaceIndex > endIndex - 100) {
      endIndex = lastSpaceIndex;
    }
    
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: messageText.substring(startIndex, endIndex),
      },
      expand: true
    });
    
    startIndex = endIndex + 1;
  }

  // Prepare the message payload
  const messagePayload = {
    channel,
    thread_ts: threadTs,
    text: messageText, // Fallback text
    unfurl_links: false,
    blocks,
  };

  // Send the message using the appropriate API
  await client.chat.postMessage(messagePayload);

  // Update status if provided
  if (updateStatus) {
    await updateStatus("");
  }
}

export async function getThread(
  channel_id: string,
  thread_ts: string,
  botUserId: string,
): Promise<CoreMessage[]> {
  const { messages } = await client.conversations.replies({
    channel: channel_id,
    ts: thread_ts,
    limit: 50,
  });

  // Ensure we have messages
  if (!messages) throw new Error("No messages found in thread");

  const result: CoreMessage[] = [];
  
  // Process each message
  for (const message of messages) {
    const isBot = !!message.bot_id;
    if (!message.text) continue;

    // For app mentions, remove the mention prefix
    // For IM messages, keep the full text
    let content = message.text;
    if (!isBot && content.includes(`<@${botUserId}>`)) {
      content = content.replace(`<@${botUserId}> `, "");
    }

    result.push({
      role: isBot ? "assistant" : "user",
      content: content,
    });
  }

  return result;
}

export const getBotId = async () => {
  const { user_id: botUserId } = await client.auth.test();

  if (!botUserId) {
    throw new Error("botUserId is undefined");
  }
  return botUserId;
};
