import Landing from './screens/Landing';
import Join from './screens/Join';
import Lobby from './screens/Lobby';
import Table from './screens/Table';
import { useStore } from './store';

export default function App() {
  const { view, error } = useStore();
  const match = /^\/r\/([A-Za-z0-9-]+)/.exec(window.location.pathname);

  if (error) {
    return (
      <main className="screen">
        <div className="brand-mark">8</div>
        <h2>Table not found</h2>
        <p className="text-muted">The link may have expired — tables close after a while.</p>
        <a className="btn btn-primary" href="/">Back to start</a>
      </main>
    );
  }
  if (!match) return <Landing />;
  if (!view) return <Join code={match[1]!} />;
  if (view.phase === 'lobby') return <Lobby />;
  if (view.phase === 'playing') return <Table />;
  return <pre style={{ padding: 24 }}>{JSON.stringify(view, null, 2)}</pre>; // Task 13 replaces
}
