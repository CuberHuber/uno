import type { Color } from '@uno/shared';

const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];

export default function ColorPicker({ onPick, title, subtitle }: {
  onPick: (c: Color) => void; title: string; subtitle?: string;
}) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog picker-dialog">
        <h3 className="picker-title">{title}</h3>
        <p className="picker-sub">{subtitle ?? 'Your wild card sets what plays next.'}</p>
        <div className="colorpicker-row">
          {COLORS.map((c) => (
            <button key={c} type="button" className="colorpicker-swatch"
              style={{ background: `var(--card-${c})` }} aria-label={c}
              onClick={() => onPick(c)} />
          ))}
        </div>
      </div>
    </div>
  );
}
