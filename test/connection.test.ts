/**
 * Connection verification test
 * Run with: npx tsx test/connection.test.ts
 */

import * as Y from 'yjs';

// Check if we're in a browser or Node environment
const isBrowser = typeof window !== 'undefined';

async function testWebTransportSupport() {
  console.log('\n=== WebTransport Support Check ===\n');
  
  if (isBrowser) {
    if (typeof WebTransport !== 'undefined') {
      console.log('✅ WebTransport is supported in this browser');
      return true;
    } else {
      console.log('❌ WebTransport is NOT supported in this browser');
      return false;
    }
  } else {
    console.log('⚠️  Running in Node.js - WebTransport requires browser');
    console.log('   Open this test in Chrome/Edge/Firefox to verify');
    return false;
  }
}

async function testYjsSetup() {
  console.log('\n=== Y.js Setup Test ===\n');
  
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  
  // Get text types
  const text1 = doc1.getText('content');
  const text2 = doc2.getText('content');
  
  // Insert text in doc1
  text1.insert(0, 'Hello World');
  
  // Sync to doc2
  const update = Y.encodeStateAsUpdate(doc1);
  Y.applyUpdate(doc2, update);
  
  const result = text2.toString();
  
  if (result === 'Hello World') {
    console.log('✅ Y.js document sync works');
    console.log(`   doc1: "${text1.toString()}"`);
    console.log(`   doc2: "${result}"`);
    return true;
  } else {
    console.log('❌ Y.js sync failed');
    return false;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   y-webtransport Verification Suite    ║');
  console.log('╚════════════════════════════════════════╝');
  
  const results = {
    webtransport: await testWebTransportSupport(),
    yjs: await testYjsSetup(),
  };
  
  console.log('\n=== Summary ===\n');
  console.log(`WebTransport Support: ${results.webtransport ? '✅' : '❌'}`);
  console.log(`Y.js Sync:           ${results.yjs ? '✅' : '❌'}`);
  
  if (!results.webtransport) {
    console.log('\n⚠️  To fully test, run the browser test:');
    console.log('   1. Start the Go server: cd server && go run .');
    console.log('   2. Open test/browser-test.html in Chrome');
  }
}

main().catch(console.error);

