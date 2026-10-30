import * as fs from 'node:fs';
import wabtFactory from 'wabt';

// The lockfile pins the compiler. No timestamps, host paths, or debug names enter the binary.
const wabt = await wabtFactory();
for (const name of ['economy', 'harness']) {
  const directory = new URL(`../examples/plugins/${name}/`, import.meta.url);
  const source = fs.readFileSync(new URL('plugin.wat', directory), 'utf8');
  const module = wabt.parseWat('plugin.wat', source);
  try {
    module.resolveNames();
    module.validate();
    const { buffer } = module.toBinary({ canonicalize_lebs: true, write_debug_names: false });
    fs.writeFileSync(new URL('plugin.wasm', directory), buffer);
    process.stdout.write(`Built ${name}: ${buffer.length} bytes\n`);
  } finally {
    module.destroy();
  }
}
