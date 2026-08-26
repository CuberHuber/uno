import CatchUpSheet from './components/CatchUpSheet';
import ConnectionBanner from './components/ConnectionBanner';
import { useT } from './i18n';
import Landing from './screens/Landing';
import Join from './screens/Join';
import Lobby from './screens/Lobby';
import RoundOver from './screens/RoundOver';
import Table from './screens/Table';
import { useStore } from './store';

export default function App() {
  const { view, error } = useStore();
  const { t, terr } = useT();
  const match = /^\/r\/([A-Za-z0-9-]+)/.exec(window.location.pathname);

  if (error) {
    const known = terr(error) !== error;
    return (
      <main className="centered">
        <div className="panel panel-pad join-card">
          <h2>{t('app.notFoundTitle')}</h2>
          <p className="card-sub">{known ? terr(error) : t('app.notFoundBody')}</p>
          <a className="btn btn-primary btn-big" href="/">{t('app.backToStart')}</a>
        </div>
      </main>
    );
  }
  const screen = !match ? <Landing />
    : !view ? <Join code={match[1]!} />
    : view.phase === 'lobby' ? <Lobby />
    : view.phase === 'playing' ? <Table />
    : <RoundOver />;
  return <><ConnectionBanner /><CatchUpSheet />{screen}</>;
}
