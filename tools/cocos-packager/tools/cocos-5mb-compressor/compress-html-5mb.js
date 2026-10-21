const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function copyIfExists(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.copyFileSync(source, destination);
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args.project || path.join(__dirname, '..', '..'));
  const inputPath = path.resolve(args.input || '');

  if (!inputPath || !fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    throw new Error(`Cannot find HTML file: ${inputPath}`);
  }
  if (path.extname(inputPath).toLowerCase() !== '.html') {
    throw new Error(`Input must be an .html file: ${inputPath}`);
  }

  const runId = `html-drop-${process.pid}-${Date.now()}`;
  const stagingRoot = path.join(projectRoot, 'build', '.html-drop', runId);
  const stagingInput = path.join(stagingRoot, 'input');
  const stagingOutput = path.join(stagingRoot, 'output');
  const stagingWork = path.join(stagingRoot, 'work');
  fs.mkdirSync(stagingInput, { recursive: true });
  fs.copyFileSync(inputPath, path.join(stagingInput, 'index.html'));

  const compressor = path.join(__dirname, 'postprocess-super-html-google-5mb.js');
  const result = childProcess.spawnSync(process.execPath, [
    compressor,
    '--project', projectRoot,
    '--input', stagingInput,
    '--output', stagingOutput,
    '--work', stagingWork,
  ], { stdio: 'inherit' });

  try {
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Compressor exited with code ${result.status}`);

    const outputDir = path.resolve(args.output || path.dirname(inputPath));
    fs.mkdirSync(outputDir, { recursive: true });
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputHtml = path.join(outputDir, `${baseName}-5mb.html`);
    const outputZip = path.join(outputDir, `${baseName}-5mb.zip`);
    fs.copyFileSync(path.join(stagingOutput, 'index.html'), outputHtml);
    fs.copyFileSync(path.join(stagingOutput, 'savedog_google.zip'), outputZip);

    const landscape = copyIfExists(
      path.join(stagingOutput, 'savedog_google_landscape.zip'),
      path.join(outputDir, `${baseName}-5mb-landscape.zip`),
    );
    const portrait = copyIfExists(
      path.join(stagingOutput, 'savedog_google_portrait.zip'),
      path.join(outputDir, `${baseName}-5mb-portrait.zip`),
    );

    console.log('\nHTML compression complete.');
    console.log(`HTML: ${outputHtml}`);
    console.log(`ZIP:  ${outputZip}`);
    if (landscape) console.log(`Landscape ZIP: ${path.join(outputDir, `${baseName}-5mb-landscape.zip`)}`);
    if (portrait) console.log(`Portrait ZIP:  ${path.join(outputDir, `${baseName}-5mb-portrait.zip`)}`);
    console.log('Original HTML was left unchanged.');
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    const stagingParent = path.dirname(stagingRoot);
    try {
      if (fs.existsSync(stagingParent) && fs.readdirSync(stagingParent).length === 0) {
        fs.rmdirSync(stagingParent);
      }
    } catch (cleanupError) {
      // Best-effort cleanup only; compression output is already complete here.
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  process.exitCode = 1;
}
