'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent, ocrDependencyGuidance, saveImageVectorNode, selectOcrLanguage } = require(path.join(__dirname, '..', 'bin/ai'));
const { VirtualFS } = require(path.join(__dirname, '..', 'bin/vfs'));
const ideRoot = path.join(__dirname, '..', '..', 'ide-engine', 'tui');
const ideAIPath = path.join(ideRoot, 'bin', 'ai.js');
const ideAI = fs.existsSync(ideAIPath) ? require(ideAIPath) : null;
const ideVfs = ideAI ? require(path.join(ideRoot, 'bin', 'vfs')) : null;

let pass = 0;
let fail = 0;
const ok = (label, condition, extra = '') => {
  if (condition) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label}${extra ? ` ${extra}` : ''}`);
  }
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-image-tools-'));
  try {
    const bytes = Buffer.from('small deterministic image fixture');
    const node = saveImageVectorNode(bytes, 300, dir);
    const saved = JSON.parse(fs.readFileSync(node.file, 'utf8'));
    ok('image vector node stores raw-image fingerprint and timestamp', saved.type === 'image-vector' && saved.algorithm === 'sha256-bytehash-v1' && saved.image_sha256.length === 64 && !!saved.created_at && !!saved.last_seen_at);
    ok('image vector node keeps requested dimensions', saved.dimensions === 300 && saved.vector.length === 300);
    const duplicate = saveImageVectorNode(bytes, 300, dir);
    ok('same image and dimensions resolve to same node', duplicate.node_id === node.node_id);
    ok('repeat observation preserves creation time', duplicate.created_at === node.created_at);

    const agent = new Agent({ config: {} });
    agent.imageVectorDir = dir;
    const image = `data:image/png;base64,${bytes.toString('base64')}`;
    const embedded = await agent.executeTool('image_embed', { image, dims: 300 });
    ok('image_embed returns a compact node reference, not the vector', embedded.includes(`IMAGE_VECTOR_NODE ${node.node_id}`) && !embedded.includes(JSON.stringify(saved.vector)));
    const first = await agent.executeTool('image_vector_read', { node_id: node.node_id, limit: 256 });
    const firstVector = JSON.parse(first.split('\n')[1]);
    ok('image_vector_read returns bounded first chunk', first.includes('[0:256 of 300]') && firstVector.length === 256 && first.includes('NEXT_OFFSET: 256'));
    const second = await agent.executeTool('image_vector_read', { node_id: node.node_id, offset: 256 });
    const secondVector = JSON.parse(second.split('\n')[1]);
    ok('image_vector_read returns remaining chunk on demand', second.includes('[256:300 of 300]') && secondVector.length === 44 && second.endsWith('COMPLETE'));
    ok('image_vector_read rejects invalid node IDs', (await agent.executeTool('image_vector_read', { node_id: '..\\state.json' })).includes('node_id image tidak valid'));

    const windows = ocrDependencyGuidance({ code: 'ENOENT' }, 'win32');
    const mac = ocrDependencyGuidance({ code: 'ENOENT' }, 'darwin');
    const linux = ocrDependencyGuidance({ code: 'ENOENT' }, 'linux');
    ok('missing Tesseract guidance requests permission before Windows install', windows.includes('DEPENDENCY_MISSING') && windows.includes('winget install --id UB-Mannheim.TesseractOCR --exact') && windows.includes('Minta izin pengguna'));
    ok('missing Tesseract guidance includes macOS install path', mac.includes('brew install tesseract'));
    ok('missing Tesseract guidance includes Linux language packages', linux.includes('tesseract-ocr-ind'));
    ok('missing OCR language data is distinguished from missing binary', ocrDependencyGuidance({ stderr: 'Error opening data file' }, 'linux').includes('OCR_LANGUAGE_DATA_MISSING'));
    ok('OCR prefers Indonesian and English when both are installed', selectOcrLanguage('List of available languages in "/usr/share/tessdata/" (2):\neng\nind') === 'ind+eng');
    ok('OCR falls back to Indonesian when English model is absent', selectOcrLanguage('List of available languages (1):\nind') === 'ind');
    ok('OCR falls back to English when Indonesian model is absent', selectOcrLanguage('List of available languages (1):\neng') === 'eng');

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(dir, 'screenshot.png'), png);
    const visionAgent = new Agent({
      vfs: new VirtualFS('vision-test', dir),
      cwd: dir,
      config: { apiKey: 'test', model: 'vision-test', provider: 'openai', providerInfo: { requiredKey: true } },
    });
    const loadedImage = await visionAgent.executeTool('inspect_image', { path: '/screenshot.png' });
    ok('inspect_image prepares validated local image for vision', loadedImage.__visionImage === true && loadedImage.mime === 'image/png' && loadedImage.dataUrl.startsWith('data:image/png;base64,'));
    const requests = [];
    visionAgent.prepareContext = async () => {};
    visionAgent.guardContext = async () => false;
    visionAgent.callModel = async (messages) => {
      requests.push(messages);
      if (requests.length === 1) {
        return {
          tool_calls: [{
            id: 'inspect-1',
            function: { name: 'inspect_image', arguments: JSON.stringify({ path: '/screenshot.png' }) },
          }],
        };
      }
      return { content: 'The screenshot shows a small image.' };
    };
    const visualAnswer = await visionAgent.run('Inspect the screenshot visually.', { maxSteps: 3, autoContinue: false });
    const visualMessage = requests[1] && requests[1].find((message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')
    );
    ok('run forwards image as multimodal context on the next model request', !!visualMessage && visualMessage.content[1].image_url.url.startsWith('data:image/png;base64,'));
    ok('vision payload remains transient rather than entering saved agent history', visionAgent.history.every((message) => !Array.isArray(message.content)));
    ok('run returns the model visual assessment', visualAnswer === 'The screenshot shows a small image.');

    if (ideAI) {
      const ideVisionAgent = new ideAI.Agent({
        vfs: new ideVfs.VirtualFS('ide-vision-test', dir),
        cwd: dir,
        config: { apiKey: 'test', model: 'vision-test', provider: 'openai', providerInfo: { requiredKey: true } },
      });
      const ideRequests = [];
      ideVisionAgent.prepareContext = async () => {};
      ideVisionAgent.guardContext = async () => false;
      ideVisionAgent.callModel = async (messages) => {
        ideRequests.push(messages);
        if (ideRequests.length === 1) {
          return {
            tool_calls: [{
              id: 'ide-inspect-1',
              function: { name: 'inspect_image', arguments: JSON.stringify({ path: '/screenshot.png' }) },
            }],
          };
        }
        return { content: 'IDE image inspected.' };
      };
      await ideVisionAgent.run('Inspect the screenshot visually.', { maxSteps: 3, autoContinue: false });
      ok('IDE agent forwards inspected screenshot to its next model request', !!(ideRequests[1] && ideRequests[1].some((message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')
      )));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
