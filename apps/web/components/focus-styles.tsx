export function FocusStyles() {
  return (
    <style>{`
      .search-field:focus-within,
      .amount-input:focus-within {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .playground-controls select:focus-visible,
      .playground-controls input:focus-visible,
      .field select:focus-visible,
      .field > input:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
    `}</style>
  );
}
