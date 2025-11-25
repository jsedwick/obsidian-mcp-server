#!/usr/bin/env node

/**
 * Test utility for Obsidian MCP Server
 * This script tests the server's functionality without requiring Claude Code
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

// These names are required for ESM compatibility
// eslint-disable-next-line @typescript-eslint/naming-convention
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(__filename);

const VAULT_PATH =
  process.env.OBSIDIAN_VAULT_PATH || path.join(process.env.HOME || '', 'obsidian-vault-test');

console.log('🧪 Testing Obsidian MCP Server');
console.log('================================\n');
console.log(`Vault path: ${VAULT_PATH}\n`);

const serverPath = path.join(__dirname, '..', 'dist', 'index.js');

const server = spawn('node', [serverPath], {
  env: {
    ...process.env,
    OBSIDIAN_VAULT_PATH: VAULT_PATH,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let responseCount = 0;
const responses: string[] = [];

server.stdout.on('data', (data: Buffer) => {
  const response = data.toString();
  console.log('📥 Response:', response);
  responses.push(response);
  responseCount++;
});

server.stderr.on('data', data => {
  console.error('📝 Server log:', data.toString());
});

function sendRequest(request: any) {
  return new Promise(resolve => {
    const currentCount = responseCount;
    console.log('\n📤 Request:', JSON.stringify(request, null, 2));
    server.stdin.write(JSON.stringify(request) + '\n');

    // Wait for response
    const checkResponse = setInterval(() => {
      if (responseCount > currentCount) {
        clearInterval(checkResponse);
        resolve(responses[responses.length - 1]);
      }
    }, 100);
  });
}

async function runTests() {
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for server to start

  try {
    // Test 1: Initialize
    console.log('\n\n🔧 Test 1: Initialize MCP');
    await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    });

    // Test 2: List tools
    console.log('\n\n🔧 Test 2: List available tools');
    await sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    // Test 3: Create a topic
    console.log('\n\n🔧 Test 3: Create a topic page');
    await sendRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'create_topic_page',
        arguments: {
          topic: 'Test Topic',
          content: 'This is a test topic page.\n\n## Details\n\nCreated during MCP server testing.',
        },
      },
    });

    // Test 4: Search vault
    console.log('\n\n🔧 Test 4: Search the vault');
    await sendRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search_vault',
        arguments: {
          query: 'test',
        },
      },
    });

    // Test 5: Close session
    console.log('\n\n🔧 Test 5: Close the session');
    await sendRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'close_session',
        arguments: {
          summary:
            'Completed testing of MCP server tools including topic creation, vault search, and session management.',
          topic: 'Testing MCP Server',
        },
      },
    });

    console.log('\n\n✅ All tests completed!');
    console.log('\nCheck your vault at:', VAULT_PATH);
    console.log('You should see:');
    console.log('  - sessions/ with a new session file');
    console.log('  - topics/test-topic.md');
    console.log('\n================================\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    server.kill();
    process.exit(0);
  }
}

runTests().catch(console.error);
