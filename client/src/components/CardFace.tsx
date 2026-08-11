import type { Card } from '@uno/shared';

const GLYPH: Partial<Record<Card['value'], string>> = {
  skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4',
};
const KIND: Partial<Record<Card['value'], string>> = {
  draw2: 'glyph-multi', wild4: 'glyph-multi',
  skip: 'glyph-sym', reverse: 'glyph-sym', wild: 'glyph-sym',
};

export default function CardFace({ card, back = false, size = 'md', playable = false, raised = false, onClick }: {
  card?: Card; back?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl';
  playable?: boolean; raised?: boolean; onClick?: () => void;
}) {
  const suit = back
    ? 'var(--card-back)'
    : card?.color ? `var(--card-${card.color})` : 'var(--card-wild)';
  return (
    <button
      type="button"
      className={`cardface cardface-${size}${back ? ' cardface-back' : ''}${playable ? ' cardface-playable' : ''}${raised ? ' cardface-raised' : ''}`}
      style={{ ['--suit' as never]: suit }}
      onClick={onClick}
      disabled={!onClick}
      aria-label={back ? 'card back' : `${card?.color ?? 'wild'} ${card?.value}`}
    >
      <span className="cardface-frame">
        {back
          ? <span className="cardface-glyph">OE</span>
          : <span className="cardface-oval">
              <span className={`cardface-glyph${card ? ` ${KIND[card.value] ?? ''}` : ''}`}>
                {card ? (GLYPH[card.value] ?? card.value) : ''}
              </span>
            </span>}
      </span>
    </button>
  );
}
