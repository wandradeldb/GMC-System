// Standardized "Back" button used across every drill-down screen (Subcontracts,
// Applications, Tracker week entry, etc.) so it looks and behaves the same everywhere.
// Purely presentational — pair it with useBackHandler(onBack, active) in the screen
// itself so the browser back button / ArrowLeft key trigger the same action as a click.
export default function BackButton({ label = 'Back', onClick, style }) {
  return (
    <button type="button" className="btn-back" onClick={onClick} style={style}>
      <span className="btn-back-arrow" aria-hidden="true">←</span>{label}
    </button>
  );
}
