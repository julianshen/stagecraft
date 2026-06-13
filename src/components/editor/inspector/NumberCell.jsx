import React, { useState, useEffect } from 'react';

// A numeric grid cell that tolerates incomplete input. Committing a coerced
// value per keystroke into a controlled number input makes negatives
// untypeable (a lone '-' reports value '' → 0 snaps under the cursor), so the
// raw string lives here: only parseable values commit, and blur restores the
// last committed value when the field was left empty/invalid.
export default function NumberCell({ value, onCommit, title }) {
  const str = (v) => (v != null ? String(v) : ''); // nullish renders empty, not "null"
  const [raw, setRaw] = useState(str(value));
  useEffect(() => { setRaw(str(value)); }, [value]); // resync on outside edits

  return (
    <input
      className="cell-input" type="number" value={raw} title={title}
      onChange={(e) => {
        const v = e.target.value;
        setRaw(v);
        const n = Number(v);
        if (v !== '' && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setRaw(str(value))}
    />
  );
}
