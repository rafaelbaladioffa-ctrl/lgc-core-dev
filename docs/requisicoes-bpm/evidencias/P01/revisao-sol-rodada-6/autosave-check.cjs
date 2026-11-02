// Isolated scheduling check of the actual hook code. React primitives/timers are
// controlled fixtures; this is not a React DOM/component acceptance test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../../../..');
const ts = require(path.join(root, 'backend/node_modules/typescript'));
const file = path.join(root, 'frontend/src/features/requisicoes-bpm/DynamicForm.tsx');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file,
}).outputText;
let nextTimer = 0; const timers = new Map(); const states = [];
const react = { useRef: (value) => ({ current: value }), useState: (value) => [value, (state) => states.push(state)], useEffect: () => {} };
const exportsObject = {};
const context = { exports: exportsObject, module: { exports: exportsObject },
  setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
  require(name) { if (name === 'react') return react; if (name === 'react/jsx-runtime') return {}; throw new Error(`Unexpected import: ${name}`); },
};
vm.runInNewContext(code, context, { filename: file });
async function main() {
  let inFlight = 0; let maximum = 0; const calls = []; const release = [];
  const save = (fields, version) => { inFlight++; maximum = Math.max(maximum, inFlight); calls.push({ fields, version }); return new Promise((resolve) => release.push(() => { inFlight--; resolve(); })); };
  const hook = context.module.exports.useDraftAutosave(save, 0);
  const flushTimer = () => { const [id, callback] = [...timers.entries()][0]; timers.delete(id); return callback(); };
  hook.schedule({ details: 'first edit' }); const first = flushTimer();
  hook.schedule({ details: 'second edit while first request is pending' }); const second = flushTimer();
  const observedBeforeResponse = { calls: [...calls], maximumConcurrentSaves: maximum, expectedMaximum: 1 };
  for (const finish of release) finish();
  await Promise.all([first, second]);
  console.log(JSON.stringify({ note: 'Actual hook scheduling with controlled primitives/timers; no DOM, network or writes.', observedBeforeResponse, stateTransitions: states }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
