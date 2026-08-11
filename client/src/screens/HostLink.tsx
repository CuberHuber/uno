export default function HostLink({ code }: { code: string }) {
  const link = `${window.location.origin}/r/${code}`;
  return (
    <main className="screen">
      <h2>Your table is ready</h2>
      <p className="text-muted">Send this link — or just the token — to your players.</p>
      <div className="code-chip">{code}</div>
      <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(link)}>
        Copy invite link
      </button>
      <a className="btn btn-primary" href={`/r/${code}`}>Open the room</a>
    </main>
  );
}
