import Landing from './screens/Landing';
import Join from './screens/Join';
import Lobby from './screens/Lobby';
import RoundOver from './screens/RoundOver';
import Table from './screens/Table';
import { useStore } from './store';

export default function App() {
  const { view, error } = useStore();
  const match = /^\/r\/([A-Za-z0-9-]+)/.exec(window.location.pathname);

  if (error) {
    return (
      <main className="centered">
        <div className="panel panel-pad join-card">
          <h2>Table not found</h2>
          <p className="card-sub">The link may have expired — tables close after a while.</p>
          <a className="btn btn-primary btn-big" href="/">Back to start</a>
        </div>
      </main>
    );
  }
  if (!match) return <Landing />;
  if (!view) return <Join code={match[1]!} />;
  if (view.phase === 'lobby') return <Lobby />;
  if (view.phase === 'playing') return <Table />;
  return <RoundOver />;
}
