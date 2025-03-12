import * as dotenv from 'dotenv';
import { jinaSearch } from './lib/tools';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// Load environment variables from .env file
dotenv.config();

// Check if JINA_API_KEY and OPENAI_API_KEY are set
if (!process.env.JINA_API_KEY) {
  console.error('Error: JINA_API_KEY environment variable is not set.');
  console.error('Please create a .env file with your Jina API key:');
  console.error('JINA_API_KEY=your_api_key_here');
  console.error('Get your Jina AI API key for free: https://jina.ai/?sui=apikey');
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  console.error('Please create a .env file with your OpenAI API key:');
  console.error('OPENAI_API_KEY=your_api_key_here');
  process.exit(1);
}

// Test function
async function testJinaSearch() {
  // Get query from command line arguments or use default
  const args = process.argv.slice(2);
  const query = args[0] || "What are the best practices for implementing a zero-trust security model?";
  
  console.log('Testing simplified Jina search...');
  console.log(`Query: "${query}"`);
  console.log('This will generate 5 related search queries and run them through Jina Search...');
  
  try {
    // Use generateText with just the jinaSearch tool to test it
    const { toolCalls, toolResults } = await generateText({
      model: openai('gpt-4o-mini'),
      tools: { jinaSearch },
      maxSteps: 2,
      messages: [
        {
          role: 'user',
          content: `Search the web for information about: ${query}`
        }
      ],
      toolChoice: {
        type: 'tool',
        toolName: 'jinaSearch'
      }
    });
    
    // Log the result
    console.log('\nTool calls:');
    console.log(JSON.stringify(toolCalls, null, 2));
    
    console.log('\nTool results:');
    console.log(JSON.stringify(toolResults, null, 2));
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
testJinaSearch(); 