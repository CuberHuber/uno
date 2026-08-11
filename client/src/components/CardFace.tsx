import type { Card } from '@uno/shared';

const GLYPH: Partial<Record<Card['value'], string>> = {
  skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4',
};

export default function CardFace({ card, back = false, size = 'md', playable = false, raised = false, onClick }: {
  card?: Card; back?: boolean; size?: 'sm' | 'md' | 'lg';
  playable?: boolean; raised?: boolean; onClick?: () => void;
}) {
  const suit = back
    ? 'var(--card-back)'
    : card?.color ? `var(--card-${card.color})` : '#3b352d';
  const glyph = back ? '8' : card ? (GLYPH[card.value] ?? card.value) : '';
  return (
    <button
      type="button"
      className={`cardface cardface-${size}${playable ? ' cardface-playable' : ''}${raised ? ' cardface-raised' : ''}`}
      style={{ ['--suit' as never]: suit }}
      onClick={onClick}
      disabled={!onClick}
      aria-label={back ? 'card back' : `${card?.color ?? 'wild'} ${card?.value}`}
    >
      <span className="cardface-frame">
        <span className="cardface-oval"><span className="cardface-glyph">{glyph}</span></span>
      </span>
    </button>
  );
}
