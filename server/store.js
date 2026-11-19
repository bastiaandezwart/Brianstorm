// Eenvoudige JSON-opslag met atomische writes. Ruim voldoende voor een team van vier.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(file) {
  let state = { boards: {}, opportunities: [], sessions: {} };
  if (fs.existsSync(file)) {
    try {
      state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (err) {
      console.error(`Kon ${file} niet lezen, start met lege opslag:`, err.message);
    }
  }

  let timer = null;
  function flush() {
    timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    get state() {
      return state;
    },
    save() {
      if (!timer) timer = setTimeout(flush, 200);
    },
    flush() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}
