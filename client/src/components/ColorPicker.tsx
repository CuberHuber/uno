import type { Color } from '@uno/shared';

const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];

export default function ColorPicker({ onPick, title }: { onPick: (c: Color) => void; title: string }) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <div className="dialog-title">{title}</div>
        <div className="colorpicker-row">
          {COLORS.map((c) => (
            <button key={c} type="button" className="colorpicker-dot"
              style={{ background: `var(--card-${c})` }} aria-label={c}
              onClick={() => onPick(c)} />
          ))}
        </div>
      </div>
    </div>
  );
}
